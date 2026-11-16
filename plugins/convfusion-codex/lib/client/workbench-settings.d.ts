import { type SettingsSend } from './settings.js';
import type { Translate } from './i18n/index.js';
export type WorkbenchLanguage = 'zh' | 'en';
export type UpdateCheckResult = {
    status: 'checking' | 'current' | 'unavailable';
} | {
    status: 'available';
    version: string;
} | null;
type UpdateSettings = {
    version: string;
    automatic: boolean;
    result: UpdateCheckResult;
    onChange: (enabled: boolean) => Promise<void>;
    onCheck: () => void;
};
export declare function WorkbenchSettings({ send, t, language, onLanguageChange, updates }: {
    send: SettingsSend;
    t: Translate;
    language: WorkbenchLanguage;
    onLanguageChange: (language: WorkbenchLanguage) => void;
    updates: UpdateSettings;
}): JSX.Element;
export {};
