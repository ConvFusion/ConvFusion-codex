import { type SettingsSend } from './settings.js';
import type { Translate } from './i18n/index.js';
export type WorkbenchLanguage = 'zh' | 'en';
export declare function WorkbenchSettings({ send, t, language, onLanguageChange }: {
    send: SettingsSend;
    t: Translate;
    language: WorkbenchLanguage;
    onLanguageChange: (language: WorkbenchLanguage) => void;
}): JSX.Element;
