/* ============================================================
   CHAT VIEW — área de mensajes + input + streaming
   Exporta: window.ChatView

   Props:
     messages      — array de mensajes del chat activo
     streamingMsg  — { log: string[], answer: string, done: bool } | null
     thinking      — bool (true mientras hay petición en curso)
     input / setInput / onSend
     chatErr
============================================================ */
const { useRef: _useRefCV, useEffect: _useEffectCV } = React;

function ChatView({ messages, streamingMsg, thinking, input, setInput, onSend, chatErr }) {
  const scrollRef = _useRefCV(null);

  // Auto-scroll al fondo: cuando llegan mensajes, tokens o el log cambia
  _useEffectCV(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMsg?.log?.length, streamingMsg?.answer?.length, thinking]);

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* ── Mensajes ── */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto nice-scroll px-4 py-5 md:px-8 md:py-6"
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-5">

          {/* Mensajes históricos */}
          {messages.map((m, i) => <Bubble key={i} m={m} />)}

          {/* ── Bloque de streaming en tiempo real ── */}
          {streamingMsg && (
            <div className="flex flex-col gap-4">
              {/* Consola de razonamiento (RAG pipeline + think del modelo) */}
              <ThinkingConsole
                log={streamingMsg.log}
                thinkContent={streamingMsg.thinkContent || ""}
                inThinking={!!streamingMsg.inThinking}
                done={streamingMsg.done}
              />

              {/*
                Burbuja de respuesta final:
                - Aparece solo cuando ya hay texto DESPUÉS de </think>
                - O cuando el modelo no usa <think> y van llegando tokens
                - Nunca muestra el contenido de <think>
              */}
              {(streamingMsg.answer.length > 0 || (streamingMsg.done && !streamingMsg.inThinking)) && (
                <Bubble
                  m={{
                    role: "assistant",
                    content: streamingMsg.answer,
                    streaming: !streamingMsg.done,
                  }}
                />
              )}
            </div>
          )}

        </div>
      </div>

      {/* ── Error ── */}
      {chatErr && (
        <div className="mx-4 mb-2 text-[12px] text-red-300/90 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          {chatErr}
        </div>
      )}

      {/* ── Input ── */}
      <div className="px-4 pb-4 pt-0">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-2">
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Pregunta sobre el reglamento F1 2026… (Enter para enviar)"
              className="flex-1 resize-none bg-transparent outline-none px-3 py-2.5 text-[14px] placeholder-white/35 max-h-40 nice-scroll"
              style={{ minHeight: 42 }}
            />
            <button
              onClick={onSend}
              disabled={thinking || !input.trim()}
              className={cls(
                "shrink-0 h-10 px-4 rounded-xl flex items-center gap-2 text-[13px] font-medium transition",
                thinking || !input.trim()
                  ? "bg-white/[0.06] text-white/35 cursor-not-allowed"
                  : "bg-gradient-to-br from-red-600 to-red-700 text-white shadow-[0_6px_22px_-8px_rgba(220,38,38,0.65)] hover:brightness-110"
              )}
            >
              {thinking
                ? <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                : <Icon.Send className="w-4 h-4" />
              }
              {thinking ? "…" : "Enviar"}
            </button>
          </div>
          <div className="px-3 pb-1 pt-0.5 flex items-center justify-between text-[10.5px] text-white/30">
            <span>Shift+Enter para nueva línea</span>
            <span className="font-mono">{input.length} ch</span>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ChatView = ChatView;
