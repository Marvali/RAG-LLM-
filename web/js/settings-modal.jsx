/* ============================================================
   SETTINGS MODAL — popup de configuración del modelo
   Exporta: window.SettingsModal
============================================================ */
const { useState: _useStateS, useEffect: _useEffectS } = React;

function SettingsModal({ open, onClose, settings, onSave, status }) {
  const [temp,     setTemp]     = _useStateS(settings.temperature ?? 0.2);
  const [topK,     setTopK]     = _useStateS(settings.topK ?? 5);
  const [useHist,  setUseHist]  = _useStateS(settings.useHistory ?? true);

  /* Sync cuando se abre */
  _useEffectS(() => {
    if (open) {
      setTemp(settings.temperature ?? 0.2);
      setTopK(settings.topK ?? 5);
      setUseHist(settings.useHistory ?? true);
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
    onSave({ temperature: temp, topK, useHistory: useHist });
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
            <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/25 grid place-items-center">
              <Icon.Cog className="w-4.5 h-4.5 text-red-300" style={{width:18,height:18}} />
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

          {/* Info backend (solo lectura) */}
          {status && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 space-y-1.5 font-mono text-[11.5px]">
              <div>
                <span className="text-white/35">LLM: </span>
                <span className="text-white/70">{status.llm_model || "—"}</span>
              </div>
              <div>
                <span className="text-white/35">embedding: </span>
                <span className="text-white/70">{status.embedding_model || "—"}</span>
              </div>
              <div>
                <span className="text-white/35">device: </span>
                <span className="text-white/70">{(status.device || "—").toUpperCase()}</span>
              </div>
              <div className="break-all">
                <span className="text-white/35">lm_studio: </span>
                <span className="text-white/70">{status.lm_studio_url || "—"}</span>
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
            className="w-full py-2.5 rounded-xl bg-gradient-to-br from-red-600 to-red-700 text-white text-[13px] font-semibold hover:brightness-110 transition shadow-[0_6px_22px_-8px_rgba(220,38,38,0.7)] flex items-center justify-center gap-2"
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
