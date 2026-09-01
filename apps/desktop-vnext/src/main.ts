import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  session,
  Tray,
  type Event as ElectronEvent,
  type MenuItem,
} from "electron";
import { createMainWindow } from "./desktop/windows.js";
import { SmartClipboardDesktopRuntime } from "./desktop/smart-clipboard-runtime.js";
import { recoveryPageUrl } from "./desktop/recovery-page.js";
import { createDshCommand } from "./runtime/dsh-command.js";
import {
  DshSupervisor,
  type DshReadyEvent,
  type DshUnavailableEvent,
} from "./runtime/dsh-supervisor.js";
import { DshRuntimeController } from "./runtime/dsh-runtime-controller.js";
import { ensureSmartClipboardProfile } from "./runtime/smart-clipboard-profile.js";
import { ensureBundledPluginProfile } from "./runtime/bundled-plugin-profile.js";
import { resolveBundledPluginPath } from "./runtime/bundled-plugin-path.js";
import { FileGenerationStateStore } from "./runtime/generation-state-store.js";
import {
  RuntimeGenerationCatalog,
  RuntimeGenerationManager,
} from "./runtime/generation-manager.js";
import { createEvidenceSink } from "./desktop/evidence.js";
import { ShutdownCoordinator } from "./desktop/shutdown-coordinator.js";
import {
  FileMainWindowStateStore,
  fitMainWindowBounds,
  sameMainWindowBounds,
  type MainWindowBounds,
} from "./desktop/main-window-state.js";
import {
  advanceDesktopStartupObservation,
  createDesktopStartupObservation,
  FileDesktopStartupObservationStore,
  type DesktopStartupStage,
} from "./desktop/startup-observation.js";
import {
  createTrayMenuTemplate,
  loginItemLabel,
  setLoginItemEnabled,
  type LoginItemPort,
  type LoginItemState,
} from "./desktop/system-integration.js";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void startDesktop().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`Hermit startup failed: ${message}`);
    app.exit(1);
  });
}

/**
 * 编排 Electron 主进程生命周期：准备本地目录、启动 DSH、挂载可选插件并注册退出回收。
 * 这里保持产品插件与 DSH Core 隔离，任何插件资格失败都只能撤下自身入口。
 */
async function startDesktop(): Promise<void> {
  await app.whenReady();

  const userData = app.getPath("userData");
  const profileHome = path.join(userData, "dsh-home");
  const workspacePath = path.join(userData, "workspace");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  const evidence = createEvidenceSink(userData);

  const generationManager = app.isPackaged
    ? new RuntimeGenerationManager({
        // M1 只接受随安装包预置的 generation；可写候选必须等 Package Gate 建立信任后接入。
        catalog: new RuntimeGenerationCatalog([
          path.join(process.resourcesPath, "runtime", "generations"),
        ]),
        store: new FileGenerationStateStore(path.join(userData, "runtime", "activation-state.json")),
        initialGeneration: "bundled",
      })
    : undefined;

  const supervisor = new DshRuntimeController({
    ...(generationManager === undefined ? {} : { generationManager }),
    createSupervisor: (generation) =>
      new DshSupervisor({
        command: createDshCommand({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          profileHome,
          workspacePath,
          ...(generation === undefined ? {} : { runtimeRoot: generation.root }),
        }),
      }),
  });

  let quitting = false;
  let quitAllowed = false;
  let dshOrigin: string | undefined;
  let dshStatus = "启动中";
  let tray: Tray | undefined;
  const initialLoginItem = app.getLoginItemSettings();
  const loginItemPort: LoginItemPort = {
    read: () => app.getLoginItemSettings(),
    write: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
  };
  let loginItemState: LoginItemState = initialLoginItem;
  const startupObservationStore = new FileDesktopStartupObservationStore(
    path.join(userData, "desktop"),
  );
  let startupObservation = createDesktopStartupObservation({
    version: app.getVersion(),
    packaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    loginItem: {
      openAtLogin: initialLoginItem.openAtLogin,
      status: initialLoginItem.status ?? "unavailable",
      wasOpenedAtLogin: initialLoginItem.wasOpenedAtLogin ?? false,
    },
  });
  let startupObservationEnabled = true;

  /** 持久化启动阶段，写入失败后停止继续写盘但不阻断桌面主流程。 */
  const recordStartupStage = (stage: DesktopStartupStage): void => {
    startupObservation = advanceDesktopStartupObservation(startupObservation, stage);
    if (!startupObservationEnabled) return;
    try {
      startupObservationStore.write(startupObservation);
    } catch (cause) {
      startupObservationEnabled = false;
      console.error(`记录桌面启动状态失败，后续记录已禁用: ${errorMessage(cause)}`);
    }
  };
  recordStartupStage("app-ready");

  const quit = (): void => app.quit();
  const restartDsh = (): void => {
    void supervisor.restart().catch((cause: unknown) => showRecovery(errorMessage(cause)));
  };
  const actions = {
    getDshOrigin: () => dshOrigin,
    restartDsh,
    quit,
  };
  const mainWindowState = new FileMainWindowStateStore(path.join(userData, "desktop"));
  let persistedMainWindowBounds: MainWindowBounds | undefined;
  let restoredMainWindowBounds: MainWindowBounds | undefined;
  try {
    persistedMainWindowBounds = mainWindowState.read();
    if (persistedMainWindowBounds !== undefined) {
      const display = screen.getDisplayMatching(persistedMainWindowBounds);
      restoredMainWindowBounds = fitMainWindowBounds(
        persistedMainWindowBounds,
        display.workArea,
        { width: 900, height: 640 },
      );
    }
  } catch (cause) {
    console.error(`恢复主窗口位置失败，将使用默认位置: ${errorMessage(cause)}`);
  }
  const mainWindow = createMainWindow(actions, restoredMainWindowBounds);
  let quickPanelVisible = false;
  const clipboardRuntime = new SmartClipboardDesktopRuntime({
    userData,
    mainWindow,
    actions,
    ipcMain,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    onQuickPanelVisibilityChanged: (visible) => {
      quickPanelVisible = visible;
    },
  });
  /** 根据当前 generation 重新核验 Smart Clipboard，并同步其捕获、IPC 与快捷键生命周期。 */
  const syncClipboardRuntime = (): void => {
    try {
      const activeRuntimeRoot = generationManager?.selectStartupGeneration().root;
      const profileCommand = createDshCommand({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        profileHome,
        workspacePath,
        ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
      });
      const pluginPath = resolveBundledPluginPath({
        packageName: "@hermit/smart-clipboard",
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
      });
      const profile = ensureSmartClipboardProfile({
        nodeBinary: profileCommand.executable,
        dshEntry: profileCommand.args[1] ?? "",
        profileHome,
        pluginPath,
        environment: profileCommand.env,
      });
      try {
        const fileWorkspacePath = resolveBundledPluginPath({
          packageName: "@hermit/file-workspace",
          isPackaged: app.isPackaged,
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
        });
        const fileWorkspaceProfile = ensureBundledPluginProfile({
          packageName: "@hermit/file-workspace",
          markerName: "file-workspace",
          nodeBinary: profileCommand.executable,
          dshEntry: profileCommand.args[1] ?? "",
          profileHome,
          pluginPath: fileWorkspacePath,
          environment: profileCommand.env,
        });
        if (fileWorkspaceProfile.state !== "active") console.info(`File Workspace ${fileWorkspaceProfile.state}，插件不会挂载到 DSH Product Surface`);
      } catch (cause) {
        console.error(`File Workspace 启动资格检查失败，插件保持不可用: ${errorMessage(cause)}`);
      }
      if (profile.state === "active") clipboardRuntime.start();
      else {
        clipboardRuntime.stop();
        console.info(`Smart Clipboard ${profile.state}，已撤销捕获、IPC 和快捷键`);
      }
    } catch (cause) {
      // 可选产品插件不能阻止 DSH Core；资格或原生加载失败时必须 fail closed。
      clipboardRuntime.stop();
      console.error(`Smart Clipboard 启动资格检查失败，插件保持不可用: ${errorMessage(cause)}`);
    }
  };
  /** 根据当前 generation 核验 Organizer 插件；资格失败只撤下 Organizer 入口。 */
  const syncOrganizerProfile = (): void => {
    try {
      const activeRuntimeRoot = generationManager?.selectStartupGeneration().root;
      const profileCommand = createDshCommand({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        profileHome,
        workspacePath,
        ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
      });
      const pluginPath = resolveBundledPluginPath({
        packageName: "@hermit/organizer",
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        ...(activeRuntimeRoot === undefined ? {} : { runtimeRoot: activeRuntimeRoot }),
      });
      const profile = ensureBundledPluginProfile({
        packageName: "@hermit/organizer",
        markerName: "personal-organizer",
        nodeBinary: profileCommand.executable,
        dshEntry: profileCommand.args[1] ?? "",
        profileHome,
        pluginPath,
        environment: profileCommand.env,
      });
      if (profile.state !== "active") console.info(`Personal Organizer ${profile.state}，不会挂载到 DSH Product Surface`);
    } catch (cause) {
      // Organizer 是可选业务插件；制品或公开能力异常时只撤下它自己的入口。
      console.error(`Personal Organizer 启动资格检查失败，插件保持不可用: ${errorMessage(cause)}`);
    }
  };
  syncOrganizerProfile();
  syncClipboardRuntime();
  const stopClipboardRuntime = (): void => clipboardRuntime.stop();

  let windowStateTimer: ReturnType<typeof setTimeout> | undefined;
  /** 保存主窗口正常态 bounds；全屏或最小化等临时状态不写入恢复文件。 */
  const persistMainWindowState = (): void => {
    if (windowStateTimer !== undefined) {
      clearTimeout(windowStateTimer);
      windowStateTimer = undefined;
    }
    if (mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    if (
      persistedMainWindowBounds !== undefined &&
      sameMainWindowBounds(bounds, persistedMainWindowBounds)
    ) {
      return;
    }
    try {
      mainWindowState.write(bounds);
      persistedMainWindowBounds = { ...bounds };
    } catch (cause) {
      console.error(`保存主窗口位置失败: ${errorMessage(cause)}`);
    }
  };
  /** 合并短时间内连续 move/resize 事件，避免频繁写盘。 */
  const scheduleMainWindowStateWrite = (): void => {
    if (windowStateTimer !== undefined) clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(persistMainWindowState, 250);
    windowStateTimer.unref();
  };
  mainWindow.on("move", scheduleMainWindowStateWrite);
  mainWindow.on("resize", scheduleMainWindowStateWrite);

  const shutdown = new ShutdownCoordinator({
    prepare: () => {
      quitting = true;
      persistMainWindowState();
      if (tray !== undefined && !tray.isDestroyed()) tray.destroy();
    },
    stopRuntime: async () => {
      stopClipboardRuntime();
      await supervisor.stop();
    },
    allowQuit: () => {
      quitAllowed = true;
    },
    quit,
    evidence,
  });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  app.on("second-instance", () => showMainWindow());
  app.on("activate", () => {
    // 快速取回是当前应用的临时前台工作面；其关闭后应回到快捷键前的应用，
    // 不能把 macOS activate 当成“打开 Hermit 主窗口”的隐式命令。
    if (!quickPanelVisible) showMainWindow();
  });

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  /** 恢复、显示并聚焦主窗口。 */
  const showMainWindow = (): void => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  /** 修改开机启动并重建菜单，让 UI 反映系统实际返回状态。 */
  const updateLoginItem = (openAtLogin: boolean): void => {
    loginItemState = setLoginItemEnabled(loginItemPort, openAtLogin, evidence);
    if (loginItemState.openAtLogin !== openAtLogin) {
      console.error(
        `开机启动未切换到请求状态（requested=${String(openAtLogin)}, status=${loginItemState.status ?? "unknown"}）`,
      );
    }
    rebuildApplicationMenu();
    rebuildTrayMenu();
  };

  /** 用最新 DSH、登录项和操作回调刷新托盘菜单。 */
  function rebuildTrayMenu(): void {
    tray?.setContextMenu(
      Menu.buildFromTemplate(createTrayMenuTemplate(
        { dshStatus, loginItem: loginItemState },
        {
          showMainWindow,
          setLoginItem: updateLoginItem,
          restartDsh,
          quit,
          recordCommand: (command) => evidence.record("desktop.tray-command", { command }),
        },
      )),
    );
  }

  /** 用最新登录项状态重建应用菜单，保持 macOS 与其他平台的角色菜单一致。 */
  function rebuildApplicationMenu(): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: app.name,
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                {
                  label: loginItemLabel(loginItemState),
                  type: "checkbox" as const,
                  checked: loginItemState.openAtLogin,
                  click: (item: MenuItem) => {
                    evidence.record("desktop.application-menu-command", { command: "login-item" });
                    updateLoginItem(item.checked);
                  },
                },
                { type: "separator" as const },
                { role: "services" as const },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : []),
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { label: "打开主窗口", click: showMainWindow },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]));
  }
  rebuildApplicationMenu();

  const icon = (await app.getFileIcon(process.execPath, { size: "small" })).resize({
    width: 16,
    height: 16,
  });
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Hermit");
  tray.on("click", () => {
    evidence.record("desktop.tray-command", { command: "icon-click" });
    showMainWindow();
  });
  evidence.record("desktop.tray-created", {
    destroyed: tray.isDestroyed(),
  });
  recordTrayBounds("created");

  rebuildTrayMenu();

  /** 将已通过 supervisor 资格检查的 DSH 页面加载进主窗口。 */
  async function loadDsh(event: DshReadyEvent): Promise<void> {
    dshOrigin = event.url.origin;
    await mainWindow.loadURL(event.url.href);
    recordTrayBounds("dsh-ready");
    showMainWindow();
  }

  /** 记录托盘 bounds 作为桌面资格诊断证据，不参与业务状态判断。 */
  function recordTrayBounds(stage: string): void {
    if (tray === undefined || tray.isDestroyed()) return;
    const bounds = tray.getBounds();
    evidence.record("desktop.tray-bounds", {
      stage,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  /** 清除失效 DSH origin 并展示可操作的恢复页。 */
  function showRecovery(message: string): void {
    dshOrigin = undefined;
    void mainWindow.loadURL(recoveryPageUrl(message)).then(showMainWindow);
  }

  supervisor.on("ready", (event: DshReadyEvent) => {
    dshStatus = "正常";
    recordStartupStage("dsh-ready");
    rebuildTrayMenu();
    syncOrganizerProfile();
    syncClipboardRuntime();
    void loadDsh(event).catch((cause: unknown) => showRecovery(errorMessage(cause)));
  });
  supervisor.on("crash", (event: { generation: number; code: number | null; signal: NodeJS.Signals | null }) => {
    stopClipboardRuntime();
    console.error(
      `DSH generation ${String(event.generation)} exited unexpectedly (code=${String(event.code)}, signal=${String(event.signal)}); restarting`,
    );
  });
  supervisor.on("unavailable", (event: DshUnavailableEvent) => {
    dshStatus = "需要处理";
    recordStartupStage("dsh-unavailable");
    rebuildTrayMenu();
    stopClipboardRuntime();
    showRecovery(event.cause.message);
  });

  app.on("before-quit", (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    void shutdown.request("app-quit");
  });

  // Electron 43 的类型声明仍把 shutdown listener 写成无参数，但运行时按官方合同传 Event。
  (powerMonitor as NodeJS.EventEmitter).on("shutdown", (event: ElectronEvent) => {
    // macOS/Linux 只有阻止默认退出，Electron 才会尝试给异步进程回收留出时间。
    if (process.platform !== "win32") event.preventDefault();
    void shutdown.request("system-shutdown");
  });
  mainWindow.on("query-session-end", (event) => {
    event.preventDefault();
    void shutdown.request("windows-query-session-end");
  });
  mainWindow.on("session-end", () => {
    void shutdown.request("windows-session-end");
  });

  process.once("SIGINT", quit);
  process.once("SIGTERM", quit);

  try {
    await supervisor.start();
  } catch (cause) {
    stopClipboardRuntime();
    showRecovery(errorMessage(cause));
  }
}

/** 把未知异常收敛为不泄露堆栈的用户可见启动错误文案。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "DSH 运行时发生未知错误";
}
