export type PreferenceLanguage = 'es' | 'en' | 'fr' | 'de';

export type PreferenceTheme = 'claro' | 'oscuro' | 'automatico';

export type PreferenceTimeFormat = '12h' | '24h';

export interface UserPreference {
  userId: string;
  language: PreferenceLanguage;
  theme: PreferenceTheme;
  dateFormat: string;
  timeFormat: PreferenceTimeFormat;
  timezone: string;
}