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
      theme:       s.theme       ?? "red",
      provider:    s.provider    ?? "local",
    };
  });
  const [settingsOpen, setSettingsOpen] = _useStateApp(false);

  function handleSaveSettings(newSettings) {
    setSettings(newSettings);
    saveSettings(newSettings);
  }

  /* ── Tab activo ── */
  const [tab, setTab] = _useStateApp("chat");

  /* ── Modo de chat: "rag" | "agent" ── */
  const [chatMode, setChatMode] = _useStateApp("rag");

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

    // Rama: modo agente (POST /api/ask/agent, no SSE)
    if (chatMode === "agent") {
      await handleSendAgent(q, chatId, updatedMsgs);
      return;
    }

    const payload = {
      question:    q,
      top_k:       settings.topK,
      temperature: settings.temperature,
      use_history: settings.useHistory,
      history: historyMsgs.filter(m => m.role === "user" || m.role === "assistant"),
      provider:    settings.provider ?? "local",
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

  /* ── Agente con function calling ── */
  async function handleSendAgent(q, chatId, updatedMsgs) {
    const buf = streamBufRef.current;
    buf.log.push("🤖 Agente RAG — iniciando bucle de razonamiento…");
    scheduleRender();

    try {
      buf.log.push("> Esperando respuesta del agente…");
      scheduleRender();

      const result = await apiPost("/api/ask/agent", {
        question:       q,
        temperature:    settings.temperature,
        max_iterations: 6,
        provider:       settings.provider ?? "local",
      });

      // Construir log desde tool_calls_log
      const log = [`🤖 Agente · ${result.iterations_used} iter · ${result.model || "—"}`];
      const extractedSources = [];
      const seenChunks = new Set();

      for (const tc of result.tool_calls_log || []) {
        if (tc.tool === "search_documents") {
          log.push(
            `> [iter ${tc.iteration}] 🔍 search("${shortName(tc.args.query, 46)}"` +
            `, top_k=${tc.args.top_k || 5})`
          );
          for (const chunk of tc.result.results || []) {
            log.push(
              `  [${chunk.rank}] ${shortName(chunk.documento, 28)}` +
              ` · #${chunk.chunk_id} · ${(chunk.score * 100).toFixed(1)}%`
            );
            const key = `${chunk.documento}-${chunk.chunk_id}`;
            if (!seenChunks.has(key)) {
              seenChunks.add(key);
              extractedSources.push({
                score:      chunk.score,
                documento:  chunk.documento,
                chunk_id:   chunk.chunk_id,
                chunk_text: chunk.text || "",
                chunk_len:  chunk.chunk_len || 0,
              });
            }
          }
        } else if (tc.tool === "calculate") {
          const res = tc.result.error
            ? `ERROR: ${tc.result.error}`
            : `= ${tc.result.result_formatted}`;
          log.push(`> [iter ${tc.iteration}] 🧮 calc(${tc.args.expression}) ${res}`);
        } else if (tc.tool === "get_current_datetime") {
          log.push(`> [iter ${tc.iteration}] 🕐 datetime → ${tc.result.datetime_utc || "—"}`);
        } else if (tc.tool === "get_index_info") {
          const nDocs = (tc.result.documents || []).length;
          log.push(
            `> [iter ${tc.iteration}] 📚 index_info →` +
            ` ${tc.result.total_fragments || 0} frags, ${nDocs} docs`
          );
        } else {
          log.push(
            `> [iter ${tc.iteration}] 🔧 ${tc.tool}` +
            `(${JSON.stringify(tc.args).slice(0, 60)})`
          );
        }
      }
      log.push("> ✓ Respuesta generada");

      const answer  = result.answer || "";
      const parsed  = parseThinkingProcess(answer);

      streamBufRef.current = {
        log,
        rawAnswer:    answer,
        thinkContent: parsed.thoughtProcess,
        answer:       parsed.finalAnswer,
        inThinking:   false,
        done:         true,
      };
      scheduleRender();
      setSources(extractedSources);

      const finalAnswer = parsed.finalAnswer || answer;
      setChats(prev => {
        const chat = prev.find(c => c.id === chatId);
        if (!chat) return prev;
        const finalMsgs = [...chat.messages, { role: "assistant", content: finalAnswer }];
        const updated   = prev.map(c =>
          c.id === chatId
            ? { ...c, messages: finalMsgs, title: getChatTitle(finalMsgs),
                summary: getChatSummary(finalMsgs), updatedAt: Date.now() }
            : c
        );
        const active = updated.find(c => c.id === chatId);
        const rest   = updated.filter(c => c.id !== chatId);
        const sorted = [active, ...rest].filter(Boolean).slice(0, MAX_CHATS);
        saveChats(sorted);
        return sorted;
      });

      setThinking(false);
      setTimeout(() => setStreamingMsg(null), 1500);

    } catch (e) {
      const msg = String(e.message || e);
      setChatErr(msg);
      streamBufRef.current.log.push(`✗ ${msg}`);
      streamBufRef.current.done = true;
      scheduleRender();

      setChats(prev => {
        const chat = prev.find(c => c.id === chatId);
        if (!chat) return prev;
        const errMsgs = [
          ...chat.messages,
          { role: "assistant", content: `⚠️ Error en el agente.\n\n\`\`\`\n${msg}\n\`\`\`` },
        ];
        return prev.map(c =>
          c.id === chatId ? { ...c, messages: errMsgs, updatedAt: Date.now() } : c
        );
      });

      setThinking(false);
      setTimeout(() => setStreamingMsg(null), 3000);
    }
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

  /* ── Sidebar ── */
  const [sidebarOpen,      setSidebarOpen]      = _useStateApp(false);   // mobile overlay
  const [desktopSidebarOn, setDesktopSidebarOn] = _useStateApp(true);    // desktop collapse

  /* ── Panel de fuentes (derecha) ── */
  const [sourcesOpen, setSourcesOpen] = _useStateApp(true);

  /* ── Render ── */
  return (
    <div className="relative w-screen h-screen overflow-hidden text-white" data-theme={settings.theme}>

      {/* Fondo: malla cromática con tema activo */}
      <div className="absolute inset-0 z-0 bg-[#050505]" />
      <div className="absolute inset-0 z-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 60% 50% at 18% 20%, var(--accent-bg20) 0%, transparent 60%),
            radial-gradient(ellipse 70% 60% at 82% 85%, var(--accent-bg10) 0%, transparent 65%),
            radial-gradient(ellipse 40% 35% at 50% 50%, rgba(255,255,255,0.025) 0%, transparent 70%)
          `,
        }}
      />
      {/* Grid sutil */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.035]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)
          `,
          backgroundSize: "44px 44px",
        }}
      />
      {/* Viñeta + glow superior */}
      <div className="absolute inset-0 z-10 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 30%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.92) 100%)" }}
      />

      {/* ── Layout ── */}
      <div className="relative z-20 h-full w-full flex">

        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <div className={cls(
          "h-full transition-all duration-300 ease-in-out overflow-hidden shrink-0",
          // Mobile: posición fija que desliza desde la izquierda
          "fixed md:relative z-40 md:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          // Desktop: colapso por ancho
          desktopSidebarOn ? "md:w-[248px]" : "md:w-0"
        )}>
          <ChatSidebar
            chats={chats}
            activeChatId={activeChatId}
            onSelectChat={(id) => { handleSelectChat(id); setSidebarOpen(false); }}
            onNewChat={() => { handleNewChat(); setSidebarOpen(false); }}
            onDeleteChat={handleDeleteChat}
            tab={tab}
            setTab={setTab}
            onOpenSettings={() => setSettingsOpen(true)}
            onCollapse={() => setDesktopSidebarOn(false)}
            status={status}
          />
        </div>

        {/* Botón flotante para re-abrir sidebar (desktop, cuando está colapsada) */}
        {!desktopSidebarOn && (
          <button
            onClick={() => setDesktopSidebarOn(true)}
            title="Mostrar sidebar"
            className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 z-50 w-8 h-16 rounded-r-xl border border-white/15 bg-black/40 backdrop-blur-xl items-center justify-center text-white/45 hover:text-white/80 hover:bg-white/[0.08] transition"
          >
            <Icon.PanelOpen className="w-4 h-4" />
          </button>
        )}

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Top bar */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.07] bg-black/20 backdrop-blur-xl shrink-0">
            {/* Mobile: abrir overlay sidebar */}
            <button
              onClick={() => setSidebarOpen(o => !o)}
              className="md:hidden w-8 h-8 rounded-lg border border-white/10 hover:bg-white/[0.08] grid place-items-center text-white/55 hover:text-white transition"
            >
              <Icon.Menu className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="text-[9.5px] uppercase tracking-[0.32em] text-white/30">
                {tab === "chat"  ? "Conversación activa"
                 : tab === "rag" ? "Documentos · Gestor RAG"
                 : "Análisis · Índice FAISS"}
              </div>
              <div className="text-[14px] font-semibold truncate leading-tight">
                {tab === "chat"  ? (activeChat?.title || "Nueva conversación")
                 : tab === "rag" ? "Documentos & Reindexado"
                 : "Estadísticas RAG"}
              </div>
            </div>

            {/* ── Selector de modo RAG / Agente ── */}
            {tab === "chat" && (
              <div className="flex items-center shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-0.5 gap-0.5">
                <button
                  onClick={() => !thinking && setChatMode("rag")}
                  disabled={thinking}
                  title="Modo RAG clásico: búsqueda + LLM directa"
                  className={cls(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition",
                    chatMode === "rag" ? "text-white" : "text-white/40 hover:text-white/65",
                    thinking && "cursor-not-allowed opacity-50"
                  )}
                  style={chatMode === "rag" ? {
                    background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
                    boxShadow:  "0 2px 8px -2px var(--accent-glow)",
                  } : undefined}
                >
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  RAG
                </button>
                <button
                  onClick={() => !thinking && setChatMode("agent")}
                  disabled={thinking}
                  title="Modo Agente: function calling, decide cuándo buscar"
                  className={cls(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition",
                    chatMode === "agent" ? "text-white" : "text-white/40 hover:text-white/65",
                    thinking && "cursor-not-allowed opacity-50"
                  )}
                  style={chatMode === "agent" ? {
                    background: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
                    boxShadow:  "0 2px 8px -2px var(--accent-glow)",
                  } : undefined}
                >
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 L13.8 9.2 L20 11 L13.8 12.8 L12 19 L10.2 12.8 L4 11 L10.2 9.2 Z"/>
                  </svg>
                  Agente
                </button>
              </div>
            )}

            {tab === "chat" && sources.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-emerald-300/80 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-2.5 py-1 shrink-0">
                <Icon.Spark className="w-3 h-3" />
                {sources.length} fuente{sources.length !== 1 ? "s" : ""}
              </div>
            )}

            {/* Toggle panel de fuentes (solo chat, solo xl) */}
            {tab === "chat" && (
              <button
                onClick={() => setSourcesOpen(o => !o)}
                title={sourcesOpen ? "Ocultar fuentes" : "Mostrar fuentes"}
                className="hidden xl:grid w-8 h-8 rounded-lg border border-white/10 hover:bg-white/[0.08] place-items-center text-white/40 hover:text-white/75 transition shrink-0"
              >
                {sourcesOpen
                  ? <Icon.PanelRightClose className="w-4 h-4" />
                  : <Icon.PanelRightOpen  className="w-4 h-4" />
                }
              </button>
            )}

            {status && (
              <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-white/35 font-mono shrink-0">
                <span
                  className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
                  style={{
                    background: settings.provider === "groq" ? "rgba(250,204,21,0.15)" : "rgba(255,255,255,0.07)",
                    color:      settings.provider === "groq" ? "#fbbf24"               : "rgba(255,255,255,0.4)",
                  }}
                >
                  {settings.provider === "groq" ? "⚡ Groq" : "💻 Local"}
                </span>
                {settings.provider === "groq"
                  ? <span>{status.groq_model || "—"}</span>
                  : <span>{status.llm_model  || "—"}</span>
                }
                {status.device && <span>· {status.device.toUpperCase()}</span>}
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
                    chatMode={chatMode}
                    setChatMode={setChatMode}
                  />
                </div>

                {/* Panel de fuentes lateral (colapsable) */}
                <div className={cls(
                  "hidden xl:flex shrink-0 border-l border-white/[0.07] flex-col bg-black/10 transition-all duration-300 overflow-hidden",
                  sourcesOpen ? "w-72" : "w-0 border-l-0"
                )}>
                  <div className="p-4 flex-1 min-h-0 overflow-y-auto nice-scroll w-72">
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

            {tab === "stats" && (
              <div className="flex-1 min-w-0 min-h-0">
                <StatsView />
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
