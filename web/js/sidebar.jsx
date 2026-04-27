/* ============================================================
   SIDEBAR — historial de chats tipo Claude
   Exporta: window.ChatSidebar
============================================================ */

function ChatSidebar({ chats, activeChatId, onSelectChat, onNewChat, onDeleteChat,
                        tab, setTab, onOpenSettings, status }) {

  const ragReady  = !!status?.ready;
  const llmOnline = !!status?.llm_connected;

  return (
    <div className="app-sidebar">

      {/* ── Logo ── */}
      <div className="px-4 py-3.5 border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-800 grid place-items-center glow-red shrink-0">
            <span className="text-base">🏁</span>
          </div>
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-[0.32em] text-white/35">Agentic RAG</div>
            <div className="text-[14px] font-semibold leading-tight">F1 2026</div>
          </div>
        </div>
      </div>

      {/* ── Tabs Chat / RAG ── */}
      <div className="px-2.5 pt-2.5 pb-2 border-b border-white/[0.07]">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { id: "chat",  label: "Chat",  IconC: Icon.Chat },
            { id: "rag",   label: "RAG",   IconC: Icon.Layers },
          ].map(({ id, label, IconC }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cls(
                "px-3 py-1.5 rounded-xl text-[12px] font-medium flex items-center justify-center gap-1.5 transition",
                tab === id
                  ? "bg-red-600/20 text-red-300 border border-red-500/30"
                  : "text-white/50 hover:text-white/80 hover:bg-white/[0.05] border border-transparent"
              )}
            >
              <IconC className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Nueva conversación ── */}
      <div className="px-2.5 pt-2.5">
        <button
          onClick={onNewChat}
          className="w-full py-2 px-3 rounded-xl border border-dashed border-white/20 hover:border-red-400/40 hover:bg-red-500/[0.06] text-[12.5px] text-white/55 hover:text-white/90 transition flex items-center justify-center gap-2"
        >
          <Icon.Plus className="w-3.5 h-3.5" />
          Nueva conversación
        </button>
      </div>

      {/* ── Historial ── */}
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll px-2.5 py-2">
        {chats.length === 0 && (
          <div className="text-center text-[11.5px] text-white/30 py-6 px-2 leading-relaxed">
            Sin conversaciones guardadas.
            <br />Empieza a escribir para crear la primera.
          </div>
        )}

        <div className="space-y-0.5">
          {chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={cls(
                  "group relative rounded-xl px-3 py-2.5 cursor-pointer transition slide-in",
                  isActive
                    ? "bg-red-500/[0.12] border border-red-500/20"
                    : "hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]"
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon.Chat className={cls(
                    "w-3.5 h-3.5 mt-0.5 shrink-0 transition",
                    isActive ? "text-red-300" : "text-white/30"
                  )} />

                  <div className="min-w-0 flex-1">
                    <div className={cls(
                      "text-[12.5px] font-medium leading-snug truncate",
                      isActive ? "text-white" : "text-white/65"
                    )}>
                      {chat.title || "Nueva conversación"}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] text-white/30">
                      <span>{Math.floor((chat.messages?.length ?? 1) / 2)} turnos</span>
                      <span>·</span>
                      <span>{relativeTime(chat.updatedAt)}</span>
                    </div>
                  </div>

                  {/* Botón eliminar (aparece en hover) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg hover:bg-red-500/20 hover:text-red-300 text-white/35 grid place-items-center transition"
                    title="Eliminar chat"
                  >
                    <Icon.Trash className="w-3 h-3" />
                  </button>
                </div>

                {/* Temas del resumen (solo en chat activo) */}
                {isActive && chat.summary?.topics?.length > 0 && (
                  <div className="mt-1.5 pl-5 space-y-0.5">
                    {chat.summary.topics.slice(0, 2).map((t, i) => (
                      <div key={i} className="text-[10.5px] text-white/35 truncate">
                        · {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Indicador de límite */}
        {chats.length >= MAX_CHATS && (
          <div className="mt-2 text-center text-[10.5px] text-white/25">
            Máximo {MAX_CHATS} chats guardados
          </div>
        )}
      </div>

      {/* ── Estado + Ajustes ── */}
      <div className="px-2.5 pb-3 pt-2.5 border-t border-white/[0.07] space-y-2">

        {/* Pills de estado compactos */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className={cls(
            "rounded-lg px-2 py-1.5 flex items-center gap-1.5 text-[10.5px] border",
            ragReady
              ? "text-emerald-300 border-emerald-400/20 bg-emerald-400/[0.07]"
              : "text-amber-300 border-amber-400/20 bg-amber-400/[0.07]"
          )}>
            <span className="pulse-dot-sm" />
            <span className="font-medium">RAG</span>
            <span className="ml-auto text-white/40 text-[10px]">
              {ragReady ? "Listo" : "Vacío"}
            </span>
          </div>
          <div className={cls(
            "rounded-lg px-2 py-1.5 flex items-center gap-1.5 text-[10.5px] border",
            llmOnline
              ? "text-emerald-300 border-emerald-400/20 bg-emerald-400/[0.07]"
              : "text-rose-300 border-rose-400/20 bg-rose-400/[0.07]"
          )}>
            <span className="pulse-dot-sm" />
            <span className="font-medium">LLM</span>
            <span className="ml-auto text-white/40 text-[10px]">
              {llmOnline ? "Online" : "Off"}
            </span>
          </div>
        </div>

        {/* Botón de ajustes */}
        <button
          onClick={onOpenSettings}
          className="w-full py-2 px-3 rounded-xl border border-white/10 hover:bg-white/[0.06] hover:border-white/20 text-[12.5px] text-white/55 hover:text-white/90 transition flex items-center gap-2"
        >
          <Icon.Cog className="w-3.5 h-3.5" />
          Ajustes del modelo
        </button>
      </div>
    </div>
  );
}

window.ChatSidebar = ChatSidebar;
