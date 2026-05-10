/* ============================================================
   SETTINGS MODAL — popup de configuración del modelo
   Exporta: window.SettingsModal
============================================================ */
const { useState: _useStateS, useEffect: _useEffectS } = React;

const THEMES = [
  { id: "red",     label: "Carmesí",    from: "#ef4444", to: "#7f1d1d" },
  { id: "blue",    label: "Cobalto",    from: "#0ea5e9", to: "#0c4a6e" },
  { id: "violet",  label: "Aurora",     from: "#a855f7", to: "#3b0764" },
  { id: "emerald", label: "Toxic",      from: "#10b981", to: "#022c22" },
  { id: "amber",   label: "Magma",      from: "#f59e0b", to: "#7c2d12" },
  { id: "magenta", label: "Neón Rosa",  from: "#ec4899", to: "#500724" },
  { id: "cyber",   label: "Cyber Lima", from: "#a3e635", to: "#0e7490" },
  { id: "white",   label: "Platino",    from: "#f1f5f9", to: "#94a3b8", dark: true },
];

function SettingsModal({ open, onClose, settings, onSave, status }) {
  const [temp,     setTemp]     = _useStateS(settings.temperature ?? 0.2);
  const [topK,     setTopK]     = _useStateS(settings.topK ?? 5);
  const [useHist,  setUseHist]  = _useStateS(settings.useHistory ?? true);
  const [theme,    setTheme]    = _useStateS(settings.theme ?? "red");
  const [provider, setProvider] = _useStateS(settings.provider ?? "local");

  /* Sync cuando se abre */
  _useEffectS(() => {
    if (open) {
      setTemp(settings.temperature ?? 0.2);
      setTopK(settings.topK ?? 5);
      setUseHist(settings.useHistory ?? true);
      setTheme(settings.theme ?? "red");
      setProvider(settings.provider ?? "local");
    }
  }, [open]);

  /* Cerrar con Escape */
  _useEffectS(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  function handleSave() {
    onSave({ temperature: temp, topK, useHistory: useHist, theme, provider });
    onClose();
  }

  const tempPct = Math.round(temp * 100);
  const topkPct = Math.round((topK / 15) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-[#0d0d0d] shadow-2xl fade-in overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl grid place-items-center"
              style={{
                background:  "var(--accent-bg20)",
                border:      "1px solid var(--accent-border)",
              }}
            >
              <Icon.Cog className="w-4.5 h-4.5" style={{ width: 18, height: 18, color: "var(--accent-text)" }} />
            </div>
            <div>
              <div className="text-[15px] font-semibold">Ajustes del modelo</div>
              <div className="text-[11px] text-white/40">Configuración de inferencia</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/10 hover:bg-white/[0.08] grid place-items-center text-white/50 hover:text-white transition"
          >
            <Icon.X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-6">

          {/* Temperatura */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium text-white/85">Temperatura</span>
              <span className="font-mono text-[12px] bg-white/[0.07] px-2 py-0.5 rounded-md text-white">
                {temp.toFixed(2)}
              </span>
            </div>
            <input
              type="range" min="0" max="1" step="0.05"
              value={temp}
              onChange={(e) => setTemp(parseFloat(e.target.value))}
              className="f1-range"
              style={{ "--p": `${tempPct}%` }}
            />
            <div className="flex justify-between text-[10.5px] text-white/35 mt-1">
              <span>Preciso</span><span>Creativo</span>
            </div>
          </div>

          {/* Top-K */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium text-white/85">Top-K (fragmentos RAG)</span>
              <span className="font-mono text-[12px] bg-white/[0.07] px-2 py-0.5 rounded-md text-white">
                {topK}
              </span>
            </div>
            <input
              type="range" min="1" max="15" step="1"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value, 10))}
              className="f1-range"
              style={{ "--p": `${topkPct}%` }}
            />
            <div className="flex justify-between text-[10.5px] text-white/35 mt-1">
              <span>Menos contexto</span><span>Más contexto</span>
            </div>
          </div>

          {/* Toggle historial */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium text-white/85">Usar historial</div>
              <div className="text-[11px] text-white/40 mt-0.5">
                Envía el contexto de la conversación al modelo
              </div>
            </div>
            <div
              className={cls("toggle-track", useHist ? "on" : "off")}
              onClick={() => setUseHist(h => !h)}
              role="switch"
              aria-checked={useHist}
            >
              <div className="toggle-thumb" />
            </div>
          </div>

          {/* Selector de proveedor LLM */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg className="text-white/50" style={{width:15,height:15}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <span className="text-[13px] font-medium text-white/85">Proveedor LLM</span>
            </div>
            <div className="flex gap-2">
              {[
                { id: "local", label: "Local", sublabel: "LM Studio", icon: "💻" },
                { id: "groq",  label: "Groq",  sublabel: status?.groq_model || "Cloud", icon: "⚡" },
              ].map((p) => {
                const active = provider === p.id;
                const groqOk = p.id === "groq" && status?.groq_connected;
                const localOk = p.id === "local" && status?.llm_connected;
                const connected = p.id === "groq" ? groqOk : localOk;
                return (
                  <button
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    className="flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-xl border transition"
                    style={{
                      borderColor: active ? "var(--accent-from)" : "rgba(255,255,255,0.1)",
                      background:  active ? "var(--accent-bg20)" : "rgba(255,255,255,0.03)",
                      boxShadow:   active ? "0 0 0 1px var(--accent-from)" : "none",
                    }}
                  >
                    <span className="text-xl">{p.icon}</span>
                    <span className="text-[12px] font-semibold" style={{ color: active ? "var(--accent-text)" : "rgba(255,255,255,0.7)" }}>
                      {p.label}
                    </span>
                    <span className="text-[10px] text-white/35 truncate max-w-full px-1">{p.sublabel}</span>
                    <span className={cls(
                      "text-[9px] font-medium px-1.5 py-0.5 rounded-full mt-0.5",
                      connected ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-white/30"
                    )}>
                      {connected ? "conectado" : "no disponible"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selector de tema */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Icon.Palette className="w-4 h-4 text-white/50" style={{width:15,height:15}} />
              <span className="text-[13px] font-medium text-white/85">Tema de color</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  title={t.label}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div
                    className="w-8 h-8 rounded-full transition-all duration-150"
                    style={{
                      background: `linear-gradient(135deg, ${t.from}, ${t.to})`,
                      outline: t.dark ? "1px solid rgba(255,255,255,0.25)" : "none",
                      boxShadow: theme === t.id
                        ? `0 0 0 2px ${t.dark ? "#555" : "#fff"}, 0 0 0 4px ${t.from}`
                        : "none",
                      transform: theme === t.id ? "scale(1.15)" : "scale(1)",
                    }}
                  />
                  <span className={cls(
                    "text-[9.5px] transition",
                    theme === t.id ? "text-white/80" : "text-white/35 group-hover:text-white/60"
                  )}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Info backend (solo lectura) */}
          {status && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 space-y-1.5 font-mono text-[11.5px]">
              <div>
                <span className="text-white/35">local: </span>
                <span className={status.llm_connected ? "text-emerald-300/80" : "text-red-300/60"}>
                  {status.llm_connected ? "●" : "○"}
                </span>
                <span className="text-white/70 ml-1">{status.llm_model || "—"}</span>
              </div>
              <div>
                <span className="text-white/35">groq: </span>
                <span className={status.groq_connected ? "text-emerald-300/80" : "text-red-300/60"}>
                  {status.groq_connected ? "●" : "○"}
                </span>
                <span className="text-white/70 ml-1">{status.groq_model || "—"}</span>
              </div>
              <div>
                <span className="text-white/35">embedding: </span>
                <span className="text-white/70">{status.embedding_model || "—"}</span>
              </div>
              <div>
                <span className="text-white/35">device: </span>
                <span className="text-white/70">{(status.device || "—").toUpperCase()}</span>
              </div>
              {status.last_error && (
                <div className="text-red-300/80 break-words">
                  ⚠ {status.last_error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={handleSave}
            className="w-full py-2.5 rounded-xl text-white text-[13px] font-semibold hover:brightness-110 transition flex items-center justify-center gap-2"
            style={{
              background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
              boxShadow:  "0 6px 22px -8px var(--accent-glow)",
            }}
          >
            <Icon.CheckCircle className="w-4 h-4" />
            Guardar y cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

window.SettingsModal = SettingsModal;
