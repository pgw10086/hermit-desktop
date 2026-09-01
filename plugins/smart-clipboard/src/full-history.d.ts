/** 默认保留的活动历史条数，不计入废纸篓。 */
export declare const DEFAULT_HISTORY_LIMIT = 100;
/** 默认允许占用的历史数据总字节数。 */
export declare const DEFAULT_TOTAL_BYTES = 1000000000;
/** 单条文本及其格式化表示允许的最大字节数。 */
export declare const MAX_TEXT_BYTES: number;
/** 单条图片允许的最大字节数。 */
export declare const MAX_IMAGE_BYTES: number;
/** 单条图片允许的最大像素数。 */
export declare const MAX_IMAGE_PIXELS: number;
/** 单条文件列表允许包含的最大项目数。 */
export declare const MAX_FILE_ITEMS = 256;
/** 文件列表 manifest 允许的最大序列化字节数。 */
export declare const MAX_FILE_MANIFEST_BYTES: number;
/** 废纸篓记录的固定保留时长。 */
export declare const TRASH_RETENTION_MS: number;
/** 支持的剪贴板内容类型。 */
export type ClipboardKind = 'TEXT' | 'IMAGE' | 'FILE_LIST';
/** 阻止临时、隐私或自动生成内容进入历史的来源标记。 */
export type ClipboardMarker = 'transient' | 'concealed' | 'auto-generated';
/** 记录位于活动历史还是废纸篓。 */
export type HistoryState = 'history' | 'trash';
/** 历史记录保留期限。 */
export type Retention = 'forever' | 30 | 90 | 365;
/** 三类剪贴板记录共用的持久化字段。 */
export interface ClipboardEntryBase {
    /** 记录稳定身份。 */
    readonly id: string;
    /** 内容类型。 */
    readonly kind: ClipboardKind;
    /** 捕获来源应用，无法识别时为空。 */
    readonly sourceApplication: string | null;
    /** 首次捕获时间，Unix 毫秒时间戳。 */
    readonly createdAt: number;
    /** 最近使用时间，Unix 毫秒时间戳。 */
    readonly lastUsedAt: number;
    /** 固定记录不会被普通清理淘汰。 */
    readonly pinned: boolean;
    /** 当前存放位置。 */
    readonly state: HistoryState;
    /** 所有持久化表示占用的字节数。 */
    readonly byteSize: number;
}
export interface TextClipboardEntry extends ClipboardEntryBase {
    /** 类型收窄为文本记录。 */
    readonly kind: 'TEXT';
    /** 纯文本内容。 */
    readonly text: string;
    /** 可选的 HTML/RTF 表示。 */
    readonly formatted?: {
        /** HTML 表示。 */
        readonly html?: string;
        /** RTF 表示。 */
        readonly rtf?: string;
    };
}
export interface ImageClipboardEntry extends ClipboardEntryBase {
    /** 类型收窄为图片记录。 */
    readonly kind: 'IMAGE';
    /** 图片原始字节，Canonical 内容不使用派生缩略图。 */
    readonly bytes: Uint8Array;
    /** 图片像素宽度。 */
    readonly width: number;
    /** 图片像素高度。 */
    readonly height: number;
    /** 是否包含透明通道。 */
    readonly hasAlpha: boolean;
}
/** 文件列表中的单个路径快照。 */
export interface FileListItem {
    /** 展示用文件名，不作为唯一身份。 */
    readonly displayName: string;
    /** 系统文件路径。 */
    readonly path: string;
    /** 当前路径指向文件或文件夹。 */
    readonly itemType: 'file' | 'folder';
    /** 最近一次刷新时路径是否存在。 */
    readonly exists: boolean;
    /** 文件大小；文件夹或不可用路径为空。 */
    readonly sizeBytes?: number;
}
export interface FileListClipboardEntry extends ClipboardEntryBase {
    /** 类型收窄为文件列表记录。 */
    readonly kind: 'FILE_LIST';
    /** 捕获时的文件列表快照。 */
    readonly items: readonly FileListItem[];
}
/** 三类剪贴板记录的 Canonical 联合类型。 */
export type ClipboardEntry = TextClipboardEntry | ImageClipboardEntry | FileListClipboardEntry;
export interface TextClipboardCapture {
    /** 类型收窄为文本捕获。 */
    readonly kind: 'TEXT';
    /** 平台读取到的纯文本。 */
    readonly text: string;
    /** 来源应用身份。 */
    readonly sourceApplication: string | null;
    /** 平台附带的过滤标记。 */
    readonly markers?: readonly ClipboardMarker[];
    /** 平台提供的格式化表示。 */
    readonly formatted?: TextClipboardEntry['formatted'];
    /** 平台捕获时间；缺失时由领域服务生成。 */
    readonly capturedAt?: number;
}
export interface ImageClipboardCapture {
    /** 类型收窄为图片捕获。 */
    readonly kind: 'IMAGE';
    /** 平台读取到的图片字节。 */
    readonly bytes: Uint8Array;
    /** 图片像素宽度。 */
    readonly width: number;
    /** 图片像素高度。 */
    readonly height: number;
    /** 是否包含透明通道。 */
    readonly hasAlpha: boolean;
    /** 来源应用身份。 */
    readonly sourceApplication: string | null;
    /** 平台附带的过滤标记。 */
    readonly markers?: readonly ClipboardMarker[];
    /** 平台捕获时间。 */
    readonly capturedAt?: number;
}
export interface FileListClipboardCapture {
    /** 类型收窄为文件列表捕获。 */
    readonly kind: 'FILE_LIST';
    /** 平台读取到的文件列表。 */
    readonly items: readonly FileListItem[];
    /** 来源应用身份。 */
    readonly sourceApplication: string | null;
    /** 平台附带的过滤标记。 */
    readonly markers?: readonly ClipboardMarker[];
    /** 平台捕获时间。 */
    readonly capturedAt?: number;
}
/** 平台捕获输入的联合类型。 */
export type ClipboardCapture = TextClipboardCapture | ImageClipboardCapture | FileListClipboardCapture;
/** 捕获结果；重复和跳过是预期业务结果。 */
export type CaptureResult = {
    readonly status: 'recorded';
    readonly entry: ClipboardEntry;
} | {
    readonly status: 'duplicate';
    readonly entry: ClipboardEntry;
} | {
    readonly status: 'skipped';
    readonly reason: CaptureSkipReason;
};
/** 捕获被跳过的可观察原因。 */
export type CaptureSkipReason = 'empty' | 'marker' | 'too-large' | 'invalid-image' | 'invalid-file-list' | 'paused' | 'storage-full';
export interface ClipboardRepository {
    /** 在指定存放位置寻找内容完全相同的记录。 */
    findDuplicate(candidate: ClipboardEntry, state: HistoryState): ClipboardEntry | undefined;
    /** 列出指定存放位置的全部记录。 */
    list(state: HistoryState): readonly ClipboardEntry[];
    /** 插入一条新记录。 */
    insert(entry: ClipboardEntry): void;
    /** 更新已有记录。 */
    update(entry: ClipboardEntry): void;
    /** 删除记录及其持久化内容。 */
    remove(id: string): void;
    /** 统计指定存放位置的记录数。 */
    count(state: HistoryState): number;
    /** 统计指定存放位置或全部记录占用的字节数。 */
    bytes(state?: HistoryState): number;
}
export interface ClipboardHistoryOptions {
    /** 活动历史条数上限。 */
    readonly historyLimit?: number;
    /** 历史数据总字节上限。 */
    readonly totalBytes?: number;
    /** 历史记录保留期限。 */
    readonly retention?: Retention;
    /** 由 Core 注入的稳定 ID 生成器。 */
    readonly idFactory?: () => string;
    /** 由调用方注入的时间源，便于领域行为测试。 */
    readonly now?: () => number;
}
export interface HistoryFilter {
    /** 对文本或文件名执行的搜索词。 */
    readonly query?: string;
    /** 内容类型筛选。 */
    readonly kind?: ClipboardKind;
    /** 来源应用筛选。 */
    readonly sourceApplication?: string;
    /** 仅显示固定记录。 */
    readonly pinnedOnly?: boolean;
}
export interface ClipboardSettings {
    /** 活动历史条数上限。 */
    readonly historyLimit: number;
    /** 历史数据总字节上限。 */
    readonly totalBytes: number;
    /** 历史记录保留期限。 */
    readonly retention: Retention;
    /** 是否暂停捕获。 */
    readonly paused: boolean;
}
/**
 * 三类剪贴板记录共用的领域服务。持久化、系统剪贴板和平台权限都从外部注入，服务本身
 * 只决定记录、去重、保留、Trash 和管理动作，避免 Quick Panel 与 History 形成两套规则。
 */
export declare class ClipboardHistoryStore {
    #private;
    constructor(repository: ClipboardRepository, options?: ClipboardHistoryOptions);
    capture(capture: ClipboardCapture): CaptureResult;
    list(filter?: HistoryFilter): readonly ClipboardEntry[];
    trash(): readonly ClipboardEntry[];
    settings(): ClipboardSettings;
    setPaused(paused: boolean): void;
    use(id: string): ClipboardEntry | undefined;
    setPinned(id: string, pinned: boolean): ClipboardEntry | undefined;
    moveToTrash(id: string): ClipboardEntry | undefined;
    restore(id: string): ClipboardEntry | undefined;
    permanentlyDelete(id: string): boolean;
    clearHistory(): number;
    emptyTrash(): number;
    purgeExpired(now?: number): number;
}
/** 仅用于领域测试和本地 fixture；生产实现由 Core 注入持久化 repository。 */
export declare class InMemoryClipboardRepository implements ClipboardRepository {
    #private;
    findDuplicate(candidate: ClipboardEntry, state: HistoryState): ClipboardEntry | undefined;
    list(state: HistoryState): readonly ClipboardEntry[];
    insert(entry: ClipboardEntry): void;
    update(entry: ClipboardEntry): void;
    remove(id: string): void;
    count(state: HistoryState): number;
    bytes(state?: HistoryState): number;
}
