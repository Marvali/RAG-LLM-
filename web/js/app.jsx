/* ============================================================
   APP — componente raíz, estado global y lógica de negocio
   Exporta: window.App
============================================================ */
const { useState: _useStateApp, useEffect: _useEffectApp,
        useCallback: _useCallbackApp, useRef: _useRefApp } = React;

function App() {

  /* ── Ajustes ── */
  const [settings, setSettings] = _useStateApp(() => {
    const s = loadSettings();
    return {
      temperature: s.temperature ?? 0.2,
      topK:        s.topK        ?? 5,
      useHistory:  s.useHistory  ?? true,
    };
  });
  const [settingsOpen, setSettingsOpen] = _useStateApp(false);

  function handleSaveSettings(newSettings) {
    setSettings(newSettings);
    saveSettings(newSettings);
  }

  /* ── Tab activo ── */
  const [tab, setTab] = _useStateApp("chat");

  /* ── Estado del backend ── */
  const [status,    setStatus]    = _useStateApp(null);
  const [statusErr, setStatusErr] = _useStateApp(null);

  const refreshStatus = _useCallbackApp(async () => {
    try {
      const s = await apiGet("/api/status");
      setStatus(s); setStatusErr(null);
    } catch (e) {
      setStatusErr(String(e.message || e));
    }
  }, []);

  _useEffectApp(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 6000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  /* ── Historial de chats ── */
  const [chats, setChats] = _useStateApp(() => {
    const saved = loadChats();
    if (saved.length > 0) return saved;
    const fresh = createNewChatObj();
    saveChats([fresh]);
    return [fresh];
  });

  const [activeChatId, setActiveChatId] = _useStateApp(() => {
    const saved = loadChats();
    return saved.length > 0 ? saved[0].id : null;
  });

  _useEffectApp(() => {
    if (!activeChatId || !chats.find(c => c.id === activeChatId)) {
      if (chats.length > 0) setActiveChatId(chats[0].id);
    }
  }, [chats, activeChatId]);

  function persistChats(updated) {
    const sorted = updated.slice(0, MAX_CHATS);
    setChats(sorted);
    saveChats(sorted);
  }

  function handleNewChat() {
    const newChat = createNewChatObj();
    persistChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
    setSources([]);
    setChatErr(null);
    setInput("");
    setStreamingMsg(null);
  }

  function handleSelectChat(id) {
    setActiveChatId(id);
    setSources([]);
    setChatErr(null);
    setStreamingMsg(null);
  }

  function handleDeleteChat(id) {
    const remaining = chats.filter(c => c.id !== id);
    if (remaining.length === 0) {
      const fresh = createNewChatObj();
      persistChats([fresh]);
      setActiveChatId(fresh.id);
    } else {
      persistChats(remaining);
      if (id === activeChatId) setActiveChatId(remaining[0].id);
    }
    setSources([]);
    setStreamingMsg(null);
  }

  const activeChat = chats.find(c => c.id === activeChatId);
  const messages   = activeChat?.messages || [];

  /* ── Chat ── */
  const [input,        setInput]        = _useStateApp("");
  const [thinking,     setThinking]     = _useStateApp(false);
  const [chatErr,      setChatErr]      = _useStateApp(null);
  const [sources,      setSources]      = _useStateApp([]);

  /**
   * streamingMsg — estado en tiempo real del proceso de IA:
   * {
   *   log:          string[],  pasos del pipeline RAG
   *   thinkContent: string,    razonamiento interno del modelo (de <think>…</think>)
   *   answer:       string,    respuesta final limpia (después de </think>)
   *   inThinking:   boolean,   true = aún dentro de <think>, sin </think> todavía
   *   done:         boolean,   true = stream completado
   * }
   */
  const [streamingMsg, setStreamingMsg] = _useStateApp(null);

  // Ref para acumular sin re-renders excesivos.
  // rawAnswer = todos los tokens juntos (puede incluir <think>...</think>)
  const streamBufRef = _useRefApp({
    log: [], rawAnswer: "", thinkContent: "", answer: "", inThinking: false, done: false
  });

  // Tick de render para actualizar la UI a ~30fps durante el streaming
  const [, forceRender] = _useStateApp(0);
  const rafRef = _useRefApp(null);

  function scheduleRender() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const buf = streamBufRef.current;
      setStreamingMsg({
        log:          [...buf.log],
        thinkContent: buf.thinkContent,
        answer:       buf.answer,
        inThinking:   buf.inThinking,
        done:         buf.done,
      });
    });
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || thinking || !activeChatId) return;

    const chatId      = activeChatId;
    const currentChat = chats.find(c => c.id === chatId);
    if (!currentChat) return;

    setInput("");
    setChatErr(null);
    setThinking(true);

    const historyMsgs = currentChat.messages;
    const updatedMsgs = [...historyMsgs, { role: "user", content: q }];

    // Guardar el mensaje del usuario inmediatamente
    setChats(prev => {
      const upd = prev.map(c =>
        c.id === chatId ? { ...c, messages: updatedMsgs, updatedAt: Date.now() } : c
      );
      saveChats(upd);
      return upd;
    });

    // Inicializar buffer de streaming
    streamBufRef.current = {
      log: [], rawAnswer: "", thinkContent: "", answer: "", inThinking: false, done: false
    };
    setStreamingMsg({ log: [], thinkContent: "", answer: "", inThinking: false, done: false });

    const payload = {
      question:    q,
      top_k:       settings.topK,
      temperature: settings.temperature,
      use_history: settings.useHistory,
      history: historyMsgs.filter(m => m.role === "user" || m.role === "assistant"),
    };
    if (currentChat.summary) payload.context_summary = currentChat.summary;

    try {
      const response = await fetch(API_BASE + "/api/ask/stream", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || response.statusText);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      // Leer el stream SSE
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // Procesar líneas SSE completas (separadas por \n\n)
        const parts = buf.split("\n\n");
        buf = parts.pop(); // fragmento incompleto al final

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(event);
          } catch {}
        }
      }

    } catch (e) {
      const msg = String(e.message || e);
      setChatErr(msg);
      streamBufRef.current = { log: [...streamBufRef.current.log, `✗ ${msg}`], answer: "", done: true };
      scheduleRender();

      // Guardar mensaje de error en el chat
      const errMsgs = [
        ...updatedMsgs,
        { role: "assistant", content: `⚠️ Error al conectar.\n\n\`\`\`\n${msg}\n\`\`\`` },
      ];
      setChats(prev => {
        const upd = prev.map(c =>
          c.id === chatId ? { ...c, messages: errMsgs, updatedAt: Date.now() } : c
        );
        saveChats(upd);
        return upd;
      });
      setThinking(false);
      // Limpiar el streamingMsg tras un momento
      setTimeout(() => setStreamingMsg(null), 3000);
      return;
    }

    // La función termina; el estado final se gestiona en handleSSEEvent('done')
  }

  function handleSSEEvent(event) {
    const buf = streamBufRef.current;

    switch (event.type) {

      case "status":
        buf.log.push(`> ${event.msg}`);
        scheduleRender();
        break;

      case "chunk":
        buf.log.push(
          `  [${event.index}] ${shortName(event.doc, 30)} · chunk #${event.chunk_id} · score ${(event.score * 100).toFixed(1)}%`
        );
        scheduleRender();
        break;

      case "token": {
        // Acumulamos el token en el raw buffer
        buf.rawAnswer += event.content;

        // Re-parseamos para separar <think> del texto final.
        // parseThinkingProcess es barato para strings cortos (<5KB).
        const parsed = parseThinkingProcess(buf.rawAnswer);
        buf.thinkContent = parsed.thoughtProcess;
        buf.answer       = parsed.finalAnswer;
        buf.inThinking   = parsed.inProgress;

        scheduleRender();
        break;
      }

      case "error":
        buf.log.push(`✗ ${event.msg}`);
        buf.done = true;
        scheduleRender();
        setChatErr(event.msg);
        setThinking(false);
        break;

      case "done": {
        // Último parse para asegurarnos de que el estado final es correcto
        const lastParsed  = parseThinkingProcess(buf.rawAnswer);
        buf.thinkContent  = lastParsed.thoughtProcess;
        buf.answer        = lastParsed.finalAnswer;
        buf.inThinking    = false; // stream terminado, ya no puede estar "en curso"
        buf.done          = true;
        buf.log.push("> ✓ Respuesta generada");
        scheduleRender();

        // finalAnswer es el texto limpio (sin <think>) que se guarda en el chat
        const finalAnswer = buf.answer;
        const finalSources = event.sources || [];
        setSources(finalSources);

        // Capturar chatId para el closure
        const chatId = activeChatId;

        // Mover la respuesta a los mensajes del chat
        setChats(prev => {
          const currentChat = prev.find(c => c.id === chatId);
          if (!currentChat) return prev;

          const finalMsgs = [
            ...currentChat.messages,
            { role: "assistant", content: finalAnswer },
          ];
          const newTitle   = getChatTitle(finalMsgs);
          const newSummary = getChatSummary(finalMsgs);

          const updated = prev.map(c =>
            c.id === chatId
              ? { ...c, messages: finalMsgs, title: newTitle, summary: newSummary, updatedAt: Date.now() }
              : c
          );
          // Chat más reciente al inicio
          const active  = updated.find(c => c.id === chatId);
          const rest    = updated.filter(c => c.id !== chatId);
          const sorted  = [active, ...rest].filter(Boolean).slice(0, MAX_CHATS);
          saveChats(sorted);
          return sorted;
        });

        setThinking(false);

        // Desvanecer la consola tras 1.5s (queda en el historial visual)
        setTimeout(() => setStreamingMsg(null), 1500);
        break;
      }
    }
  }

  /* ── RAG ── */
  const [rebuilding, setRebuilding] = _useStateApp(false);
  const [uploading,  setUploading]  = _useStateApp(false);
  const [ragErr,     setRagErr]     = _useStateApp(null);
  const [ragOk,      setRagOk]      = _useStateApp(null);
  const fileInputRef = _useRefApp(null);

  async function handleUpload(files) {
    if (!files?.length) return;
    setUploading(true); setRagErr(null); setRagOk(null);
    try {
      const r = await apiUpload(files);
      setRagOk(`Subidos ${r.saved.length} PDF(s). Pulsa "Regenerar RAG" para indexarlos.`);
      await refreshStatus();
    } catch (e) { setRagErr(String(e.message || e)); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeletePdf(name) {
    if (!confirm(`¿Borrar "${name}"?`)) return;
    try {
      await apiDelete(`/api/pdfs/${encodeURIComponent(name)}`);
      await refreshStatus();
    } catch (e) { setRagErr(String(e.message || e)); }
  }

  async function handleRebuild() {
    if (rebuilding) return;
    setRebuilding(true); setRagErr(null); setRagOk(null);
    try {
      const r = await apiPost("/api/rebuild");
      setRagOk(`Índice regenerado: ${r.n_chunks} chunks indexados.`);
      await refreshStatus();
    } catch (e) { setRagErr(String(e.message || e)); }
    finally { setRebuilding(false); }
  }

  /* ── Sidebar mobile ── */
  const [sidebarOpen, setSidebarOpen] = _useStateApp(false);

  /* ── Render ── */
  return (
    <div className="relative w-screen h-screen overflow-hidden text-white">

      {/* Vídeo de fondo */}
      <video autoPlay loop muted playsInline
        className="absolute inset-0 w-full h-full object-cover z-0">
        <source
          src="https://res.cloudinary.com/dfonotyfb/video/upload/v1775585556/dds3_1_rqhg7x.mp4"
          type="video/mp4"
        />
      </video>
      <div className="absolute inset-0 z-10 bg-black/60 pointer-events-none" />
      <div className="absolute inset-0 z-10 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 65%, rgba(0,0,0,0.95) 100%)" }}
      />
      <div className="absolute inset-0 z-10 pointer-events-none mix-blend-overlay opacity-50"
        style={{ background: "linear-gradient(180deg, rgba(220,38,38,0.10) 0%, transparent 35%, rgba(250,204,21,0.04) 100%)" }}
      />

      {/* ── Layout ── */}
      <div className="relative z-20 h-full w-full flex">

        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <div className={[
          "fixed md:relative z-40 md:z-auto h-full transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}>
          <ChatSidebar
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={(id) => { handleSelectChat(id); setSidebarOpen(false); }}
            onNewChat={() => { handleNewChat(); setSidebarOpen(false); }}
            onDeleteChat={handleDeleteChat}
            tab={tab}
            setTab={setTab}
            onOpenSettings={() => setSettingsOpen(true)}
            status={status}
          />
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Top bar */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.07] bg-black/20 backdrop-blur-xl shrink-0">
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="md:hidden w-8 h-8 rounded-lg border border-white/10 hover:bg-white/[0.08] grid place-items-center text-white/55 hover:text-white transition"
            >
              <Icon.Menu className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="text-[9.5px] uppercase tracking-[0.32em] text-white/30">
                {tab === "chat" ? "Conversación activa" : "Pit lane · Gestor RAG"}
              </div>
              <div className="text-[14px] font-semibold truncate leading-tight">
                {tab === "chat"
                  ? (activeChat?.title || "Nueva conversación")
                  : "Documentos & Reindexado"
                }
              </div>
            </div>

            {tab === "chat" && sources.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-emerald-300/80 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-2.5 py-1 shrink-0">
                <Icon.Spark className="w-3 h-3" />
                {sources.length} fuente{sources.length !== 1 ? "s" : ""}
              </div>
            )}

            {status && (
              <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-white/35 font-mono shrink-0">
                {status.llm_model && <span>{status.llm_model}</span>}
                {status.device    && <span>· {status.device.toUpperCase()}</span>}
              </div>
            )}

            {statusErr && (
              <div className="text-[11px] text-red-300/80 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1 shrink-0 max-w-[160px] truncate">
                {statusErr}
              </div>
            )}
          </div>

          {/* Contenido */}
          <div className="flex-1 min-h-0 flex overflow-hidden">

            {tab === "chat" && (
              <>
                <div className="flex-1 min-w-0 min-h-0">
                  <ChatView
                    messages={messages}
                    streamingMsg={streamingMsg}
                    thinking={thinking}
                    input={input}
                    setInput={setInput}
                    onSend={handleSend}
                    chatErr={chatErr}
                  />
                </div>

                {/* Panel de fuentes lateral */}
                <div className="hidden xl:flex w-72 shrink-0 border-l border-white/[0.07] flex-col bg-black/10">
                  <div className="p-4 flex-1 min-h-0 overflow-y-auto nice-scroll">
                    <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.25em] text-white/40 mb-3">
                      <Icon.Spark className="w-3.5 h-3.5" />
                      Fuentes consultadas
                      <span className="ml-auto text-white/25">{sources.length}</span>
                    </div>
                    {sources.length === 0 ? (
                      <div className="text-[12px] text-white/30 leading-relaxed">
                        Aquí aparecerán los fragmentos del PDF que la IA usó como evidencia, con su score de similitud y un extracto.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {sources.map((s, i) => <SourceCard key={i} s={s} idx={i} />)}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {tab === "rag" && (
              <div className="flex-1 min-w-0 min-h-0 p-4">
                <RagView
                  status={status}
                  rebuilding={rebuilding}
                  uploading={uploading}
                  ragErr={ragErr}
                  ragOk={ragOk}
                  fileInputRef={fileInputRef}
                  onUpload={handleUpload}
                  onDelete={handleDeletePdf}
                  onRebuild={handleRebuild}
                  onRefresh={refreshStatus}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de ajustes */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
        status={status}
      />
    </div>
  );
}

window.App = App;
