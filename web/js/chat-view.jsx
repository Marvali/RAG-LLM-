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
const {
  useRef: _useRefCV,
  useEffect: _useEffectCV,
  useState: _useStateCV,
} = React;

function ChatView({ messages, streamingMsg, thinking, input, setInput, onSend, chatErr }) {
  const scrollRef      = _useRefCV(null);
  const recognitionRef = _useRefCV(null);
  const [listening,    setListening]    = _useStateCV(false);
  const [micError,     setMicError]     = _useStateCV(null);
  const [micSupported, setMicSupported] = _useStateCV(
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  // Auto-scroll al fondo: cuando llegan mensajes, tokens o el log cambia
  _useEffectCV(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMsg?.log?.length, streamingMsg?.answer?.length, thinking]);

  // Limpiar reconocimiento al desmontar
  _useEffectCV(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  /* ── Micrófono / Voz-a-texto ── */
  function handleMic() {
    setMicError(null);

    // Si ya escucha, parar
    if (listening) {
      try { recognitionRef.current?.stop(); } catch {}
      setListening(false);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicError("Tu navegador no soporta reconocimiento de voz (usa Chrome o Edge).");
      return;
    }

    const recognition = new SR();
    recognitionRef.current = recognition;

    recognition.lang            = "es-ES";
    recognition.continuous      = false;   // una sola frase
    recognition.interimResults  = true;    // muestra texto mientras habla

    // Capturamos texto parcial en tiempo real
    recognition.onresult = (e) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed") {
        setMicError("Permiso de micrófono denegado. Actívalo en la configuración del navegador.");
      } else if (e.error !== "no-speech") {
        setMicError(`Error de voz: ${e.error}`);
      }
    };

    try {
      recognition.start();
      setListening(true);
    } catch {
      setMicError("No se pudo iniciar el micrófono.");
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

      {/* ── Error del chat ── */}
      {chatErr && (
        <div className="mx-4 mb-2 text-[12px] text-red-300/90 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          {chatErr}
        </div>
      )}

      {/* ── Error del micrófono ── */}
      {micError && (
        <div className="mx-4 mb-2 text-[12px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
          <span>🎙️</span>
          <span className="flex-1">{micError}</span>
          <button
            onClick={() => setMicError(null)}
            className="text-white/40 hover:text-white/70 transition"
          >
            <Icon.X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Input ── */}
      <div className="px-4 pb-4 pt-0">
        <div
          className="rounded-2xl border bg-white/[0.04] backdrop-blur-xl p-2 transition-all duration-200"
          style={{
            borderColor: listening
              ? "var(--accent-border)"
              : "rgba(255,255,255,0.10)",
            boxShadow: listening
              ? "0 0 0 2px var(--accent-bg20)"
              : "none",
          }}
        >
          <div className="flex items-end gap-2">

            {/* Botón micrófono */}
            {micSupported && (
              <button
                onClick={handleMic}
                disabled={thinking}
                title={listening ? "Detener grabación" : "Hablar para escribir"}
                className={cls(
                  "shrink-0 h-10 w-10 rounded-xl flex items-center justify-center transition border",
                  thinking
                    ? "opacity-30 cursor-not-allowed border-transparent"
                    : listening
                      ? "border-transparent text-white animate-pulse"
                      : "border-white/10 text-white/45 hover:text-white/80 hover:bg-white/[0.06]"
                )}
                style={listening ? {
                  background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
                  boxShadow: "0 0 18px -4px var(--accent-glow)",
                } : undefined}
              >
                {listening
                  ? (
                    /* Icono de onda animada mientras escucha */
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8"  y1="23" x2="16" y2="23"/>
                    </svg>
                  )
                  : (
                    /* Micrófono normal */
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8"  y1="23" x2="16" y2="23"/>
                    </svg>
                  )
                }
              </button>
            )}

            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                listening
                  ? "🎙️ Escuchando… habla ahora"
                  : "Pregunta sobre el reglamento F1 2026… (Enter para enviar)"
              }
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
                  : "text-white hover:brightness-110"
              )}
              style={!(thinking || !input.trim()) ? {
                background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
                boxShadow:  "0 6px 22px -8px var(--accent-glow)",
              } : undefined}
            >
              {thinking
                ? <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                : <Icon.Send className="w-4 h-4" />
              }
              {thinking ? "…" : "Enviar"}
            </button>
          </div>

          {/* Barra inferior: info + indicador de voz */}
          <div className="px-3 pb-1 pt-0.5 flex items-center justify-between text-[10.5px] text-white/30">
            {listening ? (
              <span className="flex items-center gap-1.5" style={{ color: "var(--accent-text)" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--accent-from)" }} />
                Grabando — pulsa el micrófono o espera para terminar
              </span>
            ) : (
              <span>Shift+Enter para nueva línea{micSupported ? " · 🎙️ micrófono disponible" : ""}</span>
            )}
            <span className="font-mono">{input.length} ch</span>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ChatView = ChatView;
