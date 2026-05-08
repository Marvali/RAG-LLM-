/* ============================================================
   COMPONENTS — componentes pequeños reutilizables
   Exporta: window.F1Loader, window.SourceCard, window.Bubble,
            window.StatusPill, window.ThinkingConsole
============================================================ */
const { useState: _useState, useRef: _useRef, useEffect: _useEffect } = React;

/* ─────────────────────────────────────────
   F1 LOADER
───────────────────────────────────────── */
function F1Loader({ label = "Pensando…" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 fade-in">
      <div className="f1-track">
        <div className="f1-core" />
        <div className="f1-orbit">
          <div className="f1-trail" />
          <div className="f1-car" />
        </div>
      </div>
      <div className="text-xs uppercase tracking-[0.3em] text-white/60">{label}</div>
    </div>
  );
}

/* ─────────────────────────────────────────
   THINKING CONSOLE
   Muestra:
     1) Log del RAG pipeline (status + chunks)
     2) Razonamiento interno del modelo (<think>…</think>)
   en una consola compacta con scroll y barra
   de título estilo terminal.

   Props:
     log          — string[]   pasos del pipeline RAG
     thinkContent — string     texto del bloque <think> (vacío si no hay)
     inThinking   — boolean    true = aún dentro de <think> (streaming)
     done         — boolean    true = respuesta completada
───────────────────────────────────────── */
function ThinkingConsole({ log, thinkContent, inThinking, done, mode = "rag" }) {
  const [collapsed,      setCollapsed]      = _useState(false);
  const [thinkCollapsed, setThinkCollapsed] = _useState(false);
  const bottomRef     = _useRef(null);
  const thinkEndRef   = _useRef(null);

  // Auto-scroll al fondo del log RAG
  _useEffect(() => {
    if (!collapsed && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [log.length, collapsed]);

  // Auto-scroll dentro del bloque de razonamiento
  _useEffect(() => {
    if (!thinkCollapsed && thinkEndRef.current) {
      thinkEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [thinkContent, thinkCollapsed]);

  const hasThink = thinkContent && thinkContent.trim().length > 0;

  // Estado de la consola: running / thinking / done
  const consoleStatus = done ? "done"
    : inThinking        ? "thinking"
    : "running";

  const statusColors = {
    running:  "text-yellow-400/60",
    thinking: "text-violet-400/70",
    done:     "text-emerald-400/60",
  };
  const statusLabels = {
    running:  "● running",
    thinking: "● thinking…",
    done:     "● done",
  };

  return (
    <div className="w-full flex justify-start fade-in">
      <div className="w-full max-w-[88%]">

        {/* ── Cabecera toggle principal ── */}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-2 text-[11px] text-white/40 hover:text-white/65 transition mb-1.5 select-none"
        >
          <span
            className="text-[9px] inline-block transition-transform duration-200"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >▼</span>
          <span className="font-mono uppercase tracking-[0.18em]">Proceso de razonamiento</span>

          {consoleStatus === "running" && (
            <span className="flex items-center gap-1 text-yellow-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              {mode === "agent" ? "agente" : "RAG"}
            </span>
          )}
          {consoleStatus === "thinking" && (
            <span className="flex items-center gap-1 text-violet-400/80">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              pensando
            </span>
          )}
          {consoleStatus === "done" && (
            <span className="text-emerald-400/60">✓ completado</span>
          )}
        </button>

        {/* ── Consola ── */}
        {!collapsed && (
          <div className="rounded-xl bg-black/72 border border-white/[0.08] overflow-hidden">

            {/* Barra de título estilo macOS */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.06] select-none">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/65" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/65" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/65" />
              <span className="ml-2 text-[10px] text-white/22 font-mono tracking-wide">
                {mode === "agent" ? "agent-loop" : "rag-pipeline"}
              </span>
              <span className={cls("ml-auto text-[9.5px] font-mono", statusColors[consoleStatus],
                consoleStatus !== "done" && "animate-pulse")}>
                {statusLabels[consoleStatus]}
              </span>
            </div>

            {/* ── Sección 1: Log del pipeline RAG ── */}
            <div className="max-h-36 overflow-y-auto nice-scroll px-3 pt-2.5 pb-1 space-y-0.5 font-mono text-[11.5px]">
              {log.map((line, i) => (
                <div key={i} className="text-white/58 leading-relaxed whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))}
              {/* Cursor parpadeante (solo cuando el pipeline RAG está activo, no cuando piensa) */}
              {!done && !inThinking && (
                <div className="flex items-center gap-1 text-white/25">
                  <span>$</span>
                  <span className="inline-block w-[7px] h-[13px] bg-white/35 animate-pulse" />
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* ── Sección 2: Razonamiento interno del modelo ── */}
            {hasThink && (
              <div className="border-t border-white/[0.07]">
                {/* Sub-cabecera colapsable */}
                <button
                  onClick={() => setThinkCollapsed(c => !c)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 bg-violet-500/[0.06] hover:bg-violet-500/[0.10] transition text-left select-none"
                >
                  <span
                    className="text-[8px] text-violet-300/50 inline-block transition-transform duration-200"
                    style={{ transform: thinkCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                  >▼</span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300/55">
                    Razonamiento interno del modelo
                  </span>
                  {inThinking && (
                    <span className="ml-auto flex items-center gap-1 text-[9px] text-violet-400/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400/80 animate-pulse" />
                      escribiendo…
                    </span>
                  )}
                  {!inThinking && (
                    <span className="ml-auto text-[9px] text-violet-300/35 font-mono">
                      {thinkContent.trim().length} chars
                    </span>
                  )}
                </button>

                {!thinkCollapsed && (
                  <div className="max-h-52 overflow-y-auto nice-scroll px-3 py-2.5 font-mono text-[11.5px] bg-violet-950/20">
                    <div className="text-violet-200/50 leading-relaxed whitespace-pre-wrap break-words">
                      {thinkContent}
                      {/* Cursor animado mientras el modelo sigue pensando */}
                      {inThinking && (
                        <span
                          className="inline-block w-[7px] h-[14px] ml-0.5 bg-violet-400/60 align-middle"
                          style={{ animation: "pulse 0.8s step-end infinite" }}
                        />
                      )}
                    </div>
                    <div ref={thinkEndRef} />
                  </div>
                )}
              </div>
            )}

            {/* Padding inferior */}
            <div className="h-1.5" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   SOURCE CARD
───────────────────────────────────────── */
function SourceCard({ s, idx }) {
  const [open, setOpen] = _useState(false);
  const score = (s.score * 100).toFixed(1);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] transition p-3 fade-in">
      <div className="flex items-start gap-2">
        <div
          className="shrink-0 w-7 h-7 rounded-lg grid place-items-center text-[11px] font-semibold"
          style={{
            background: "var(--accent-bg20)",
            border:     "1px solid var(--accent-border)",
            color:      "var(--accent-text)",
          }}
        >
          {idx + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-white/90 font-medium truncate" title={s.documento}>
            {shortName(s.documento, 38)}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-white/50">
            <span>chunk #{s.chunk_id}</span>
            <span className="w-1 h-1 rounded-full bg-white/30" />
            <span className="text-emerald-300/90">score {score}%</span>
          </div>
        </div>
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        className="mt-2 text-[11px] text-white/50 hover:text-white/80 transition"
      >
        {open ? "Ocultar fragmento ↑" : "Ver fragmento ↓"}
      </button>
      {open && (
        <pre className="mt-2 max-h-44 overflow-auto nice-scroll text-[11.5px] leading-relaxed text-white/75 whitespace-pre-wrap font-mono bg-black/40 border border-white/5 rounded-lg p-2">
{(s.chunk_text || "").slice(0, 1200)}
        </pre>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   BUBBLE — mensaje de chat
   Asistente: botones Copiar + TTS (leer en voz alta)
   Burbuja de usuario usa CSS vars del tema activo.
───────────────────────────────────────── */

/** Quita marcado Markdown para que el TTS lea texto limpio */
function _stripMd(md) {
  return (md || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

function Bubble({ m }) {
  const isUser = m.role === "user";
  const [copied,   setCopied]   = _useState(false);
  const [speaking, setSpeaking] = _useState(false);

  /* ── Copiar ── */
  function handleCopy() {
    navigator.clipboard.writeText(m.content || "").then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = m.content || "";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  /* ── Text-to-Speech ── */
  function handleSpeak() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const text = _stripMd(m.content);
    if (!text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = "es-ES";
    utter.rate  = 0.97;
    utter.onend   = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
    setSpeaking(true);
  }

  /* Burbuja usuario: usa tokens del tema activo */
  const userBubbleStyle = {
    background:  "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
    boxShadow:   "0 8px 30px -10px var(--accent-glow)",
    borderColor: "var(--accent-border)",
  };

  return (
    <div className={cls("w-full flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cls("group relative", isUser ? "max-w-[80%]" : "max-w-[85%] w-full")}>

        {/* Burbuja */}
        <div
          className={cls(
            "rounded-2xl px-4 py-3 fade-in border",
            !isUser && cls(
              "bg-white/[0.06] backdrop-blur-md text-white/90",
              m.streaming ? "border-white/20" : "border-white/10"
            )
          )}
          style={isUser ? userBubbleStyle : undefined}
        >
          {!isUser && (
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-5 h-5 rounded-md grid place-items-center"
                style={{ background: "var(--accent-bg10)", border: "1px solid var(--accent-border)" }}
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-text)" }}>
                  <path d="M12 3 L13.8 9.2 L20 11 L13.8 12.8 L12 19 L10.2 12.8 L4 11 L10.2 9.2 Z" />
                </svg>
              </div>
              <span className="text-[10.5px] uppercase tracking-[0.22em] text-white/45">Asistente</span>
              {m.streaming && (
                <span className="ml-auto flex items-center gap-1 text-[10px] text-white/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                  escribiendo
                </span>
              )}
            </div>
          )}

          <div
            className={cls("prose-rag text-[14px]", !isUser && "text-white/90")}
            style={isUser ? { color: "var(--bubble-user-text)" } : undefined}
            dangerouslySetInnerHTML={{ __html: mdToHtml(m.content || "") }}
          />

          {m.streaming && (
            <span
              className="inline-block w-[7px] h-[15px] ml-0.5 bg-white/50 align-middle"
              style={{ animation: "pulse 0.9s step-end infinite" }}
            />
          )}
        </div>

        {/* Botones flotantes Leer + Copiar (solo asistente, no streaming) */}
        {!isUser && !m.streaming && m.content && (
          <div className="absolute -bottom-7 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">

            {/* TTS */}
            <button
              onClick={handleSpeak}
              title={speaking ? "Detener lectura" : "Leer en voz alta"}
              className={cls(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition border",
                speaking
                  ? "bg-sky-500/20 border-sky-400/30 text-sky-300"
                  : "bg-black/50 border-white/15 text-white/55 hover:text-white/85 hover:bg-white/[0.08]"
              )}
            >
              {speaking
                ? <Icon.VolumeX className="w-3 h-3" />
                : <Icon.Volume   className="w-3 h-3" />
              }
              {speaking ? "Parar" : "Leer"}
            </button>

            {/* Copiar */}
            <button
              onClick={handleCopy}
              title="Copiar respuesta"
              className={cls(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition border",
                copied
                  ? "bg-emerald-500/20 border-emerald-400/30 text-emerald-300"
                  : "bg-black/50 border-white/15 text-white/55 hover:text-white/85 hover:bg-white/[0.08]"
              )}
            >
              {copied ? (
                <><Icon.CheckCircle className="w-3 h-3" />Copiado</>
              ) : (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copiar
                </>
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   STATUS PILL
───────────────────────────────────────── */
function StatusPill({ color = "emerald", label, value }) {
  const map = {
    emerald: "text-emerald-300 border-emerald-400/25 bg-emerald-400/10",
    amber:   "text-amber-300 border-amber-400/25 bg-amber-400/10",
    rose:    "text-rose-300 border-rose-400/25 bg-rose-400/10",
    sky:     "text-sky-300 border-sky-400/25 bg-sky-400/10",
    violet:  "text-violet-300 border-violet-400/25 bg-violet-400/10",
  };
  return (
    <div className={cls("rounded-xl border px-2.5 py-1.5", map[color])}>
      <div className="flex items-center gap-1.5">
        <span className="pulse-dot" />
        <span className="text-[10px] uppercase tracking-[0.18em] opacity-80">{label}</span>
      </div>
      <div className="mt-0.5 text-[12.5px] font-medium text-white/95 truncate">{value}</div>
    </div>
  );
}

/* ── Exportar ── */
window.F1Loader       = F1Loader;
window.ThinkingConsole = ThinkingConsole;
window.SourceCard     = SourceCard;
window.Bubble         = Bubble;
window.StatusPill     = StatusPill;
