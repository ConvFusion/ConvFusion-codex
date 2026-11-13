import React from 'react'
import { CommunityTab, ConvFusionProjectSettings, DecisionAssistControl, type SettingsSend } from './settings.js'
import type { Translate } from './i18n/index.js'

const categories = ['user', 'server', 'research', 'system'] as const
type Category = (typeof categories)[number]
export type WorkbenchLanguage = 'zh' | 'en'

export function WorkbenchSettings({ send, t, language, onLanguageChange }: {
  send: SettingsSend
  t: Translate
  language: WorkbenchLanguage
  onLanguageChange: (language: WorkbenchLanguage) => void
}): JSX.Element {
  const [category, setCategory] = React.useState<Category>('user')

  const panels: Record<Category, () => JSX.Element> = {
    user: () => <>
      <div className="preferences-card">
        <label className="preferences-row">
          <span>{t('workbench.settings.language')}</span>
          <select value={language} onChange={(e) => onLanguageChange(e.target.value as WorkbenchLanguage)}>
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
      <CommunityTab send={send} initial={null} t={t} view="user-settings" />
    </>,
    server: () => <CommunityTab send={send} initial={null} t={t} view="server-settings" />,
    research: () => <ResearchSettings send={send} t={t} />,
    system: () => <ConvFusionProjectSettings send={send} t={t} view="system" />,
  }

  return <section className="preferences" aria-labelledby="preferences-title">
    <h2 id="preferences-title">{t('workbench.settings.title')}</h2>
    <div className="preferences-layout">
      <nav className="preferences-nav" aria-label={t('workbench.settings.categories')}>
        {categories.map((item) => (
          <button key={item} type="button" aria-current={category === item ? 'true' : undefined}
            onClick={() => setCategory(item)}>{t(`workbench.settings.category.${item}`)}</button>
        ))}
      </nav>
      <section key={category} className="preferences-content" aria-labelledby="preferences-category">
        <h3 id="preferences-category">{t(`workbench.settings.category.${category}`)}</h3>
        {panels[category]()}
      </section>
    </div>
  </section>
}

type ContinuationPolicy = { enabled: boolean; maxRounds: number }
type ResearchPreference = 'decision' | 'autoContinue' | 'autoContinueMaxRounds'

function ResearchSettings({ send, t }: { send: SettingsSend; t: Translate }): JSX.Element {
  const [decision, setDecision] = React.useState<boolean | null>(null)
  const [policy, setPolicy] = React.useState<ContinuationPolicy | null>(null)
  const [rounds, setRounds] = React.useState('')
  const [saving, setSaving] = React.useState<ResearchPreference | null>(null)
  const [decisionError, setDecisionError] = React.useState('')
  const [continuationError, setContinuationError] = React.useState('')

  React.useEffect(() => {
    const controller = new AbortController()
    const load = async (endpoint: string, apply: (value: unknown) => void, fail: (message: string) => void) => {
      try {
        const res = await send(endpoint, {}, controller.signal)
        if (!res.ok) throw new Error(res.error?.message ?? t('settings.error.unknown'))
        if (!controller.signal.aborted) apply(res.value)
      } catch (error) {
        if (!controller.signal.aborted) fail(error instanceof Error ? error.message : String(error))
      }
    }
    void load('account/state', (value) => setDecision((value as { decisionAssistEnabled?: boolean }).decisionAssistEnabled !== false), setDecisionError)
    void load('codex/continuation', (value) => {
      const next = value as ContinuationPolicy
      setPolicy(next)
      setRounds(String(next.maxRounds))
    }, setContinuationError)
    return () => controller.abort()
  }, [send, t])

  const save = async (field: ResearchPreference, value: boolean | number) => {
    if (saving) return
    const setError = field === 'decision' ? setDecisionError : setContinuationError
    setSaving(field)
    setError('')
    try {
      const result = field === 'decision'
        ? await send('account/decision-assist', { enabled: value })
        : await send('codex/settings', { field, value })
      if (!result.ok) throw new Error(result.error?.message ?? t('settings.error.unknown'))
      if (field === 'decision') setDecision((result.value as { decisionAssistEnabled?: boolean }).decisionAssistEnabled !== false)
      else setPolicy((old) => old && (field === 'autoContinue'
        ? { ...old, enabled: value as boolean }
        : { ...old, maxRounds: value as number }))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(null)
    }
  }

  const roundLimit = Number(rounds)
  const validLimit = rounds.trim() !== '' && Number.isInteger(roundLimit) && roundLimit >= 0 && roundLimit <= 100
  return <>
    <div className="preferences-card">
      <h4>{t('workbench.settings.decision')}</h4>
      <DecisionAssistControl checked={decision === true} disabled={decision === null || saving !== null} t={t}
        onChange={(enabled) => { void save('decision', enabled) }} />
      {decisionError && <p role="alert">{decisionError}</p>}
    </div>
    <div className="preferences-card">
      <h4>{t('workbench.settings.continuation')}</h4>
      <label className="preferences-check">
        <input type="checkbox" disabled={!policy || saving !== null} checked={policy?.enabled ?? false}
          onChange={(e) => { void save('autoContinue', e.target.checked) }} />
        <span>{t('workbench.settings.autoContinue')}</span>
      </label>
      <form className="preferences-form" onSubmit={(e) => {
        e.preventDefault()
        if (policy && validLimit && roundLimit !== policy.maxRounds) void save('autoContinueMaxRounds', roundLimit)
      }}>
        <label className="preferences-row">
          <span>{t('workbench.settings.continuationLimit')}</span>
          <input type="number" min={0} max={100} step={1} required value={rounds}
            disabled={!policy || saving !== null} onChange={(e) => setRounds(e.target.value)} />
        </label>
        <button type="submit" disabled={!policy || !validLimit || roundLimit === policy.maxRounds || saving !== null}>
          {t(saving === 'autoContinueMaxRounds' ? 'settings.editor.saving' : 'settings.editor.save')}
        </button>
      </form>
      {continuationError && <p role="alert">{continuationError}</p>}
    </div>
  </>
}
