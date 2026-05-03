/* ============================================================
   RAG VIEW — gestión de documentos e índice FAISS
   Exporta: window.RagView
============================================================ */
const { useState: _useStateRV } = React;

function RagView({ status, rebuilding, uploading, ragErr, ragOk,
                   fileInputRef, onUpload, onDelete, onRebuild, onRefresh }) {

  const [drag, setDrag] = _useStateRV(false);

  function onDragOver(e)  { e.preventDefault(); setDrag(true);  }
  function onDragLeave(e) { e.preventDefault(); setDrag(false); }
  function onDrop(e) {
    e.preventDefault(); setDrag(false);
    const files = Array.from(e.dataTransfer.files || []).filter(f =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (files.length) onUpload(files);
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto nice-scroll">
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 gap-4 p-1">

        {/* ── Columna izquierda: upload + rebuild + info ── */}
        <div className="xl:col-span-1 flex flex-col gap-4">

          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cls(
              "rounded-2xl border-2 border-dashed transition p-6 text-center bg-white/[0.03] backdrop-blur-xl",
              drag ? "border-red-400/70 bg-red-500/[0.07]" : "border-white/15 hover:border-white/30"
            )}
          >
            <div className="mx-auto w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 grid place-items-center">
              <Icon.Upload className="w-5 h-5 text-red-300" />
            </div>
            <div className="mt-3 text-[14px] font-medium">Arrastra PDFs aquí</div>
            <div className="text-[12px] text-white/50 mt-1">o haz clic para seleccionar</div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => onUpload(Array.from(e.target.files || []))}
            />
            <button
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className={cls(
                "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition",
                uploading
                  ? "bg-white/[0.06] text-white/35"
                  : "bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10"
              )}
            >
              <Icon.Plus className="w-4 h-4" />
              {uploading ? "Subiendo…" : "Seleccionar PDFs"}
            </button>
          </div>

          {/* Regenerar índice */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-white/50 mb-2">
              <Icon.Refresh className="w-3.5 h-3.5" /> Regenerar índice
            </div>
            <p className="text-[12.5px] text-white/60 leading-relaxed">
              Si añades o eliminas PDFs, regenera el RAG para actualizar embeddings y el índice FAISS.
            </p>
            <button
              onClick={onRebuild}
              disabled={rebuilding || (status?.n_pdfs ?? 0) === 0}
              className={cls(
                "mt-4 w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold transition flex items-center justify-center gap-2",
                rebuilding
                  ? "bg-white/[0.06] text-white/45 cursor-not-allowed"
                  : (status?.n_pdfs ?? 0) === 0
                    ? "bg-white/[0.06] text-white/30 cursor-not-allowed"
                    : "bg-gradient-to-br from-red-600 to-red-700 text-white shadow-[0_6px_22px_-8px_rgba(220,38,38,0.65)] hover:brightness-110"
              )}
            >
              {rebuilding ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  Regenerando…
                </>
              ) : (
                <>
                  <Icon.Refresh className="w-4 h-4" /> Regenerar RAG
                </>
              )}
            </button>

            {rebuilding && (
              <div className="mt-5">
                <F1Loader label="Indexando documentos…" />
              </div>
            )}
            {ragOk && (
              <div className="mt-3 text-[12px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2">
                ✓ {ragOk}
              </div>
            )}
            {ragErr && (
              <div className="mt-3 text-[12px] text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 break-words">
                ✗ {ragErr}
              </div>
            )}
          </div>

          {/* Info backend */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 text-[11.5px] text-white/55 space-y-1.5 font-mono">
            <div><span className="text-white/35">embed:</span> {status?.embedding_model || "—"}</div>
            <div><span className="text-white/35">device:</span> {status?.device || "—"}</div>
            <div><span className="text-white/35">llm:</span> {status?.llm_model || "—"}</div>
            <div className="break-all"><span className="text-white/35">lm_studio:</span> {status?.lm_studio_url || "—"}</div>
          </div>
        </div>

        {/* ── Columna derecha: lista de PDFs ── */}
        <div className="xl:col-span-2 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 flex flex-col min-h-[300px]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-white/50">
              <Icon.Doc className="w-3.5 h-3.5" /> Documentos en data/
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-white/40">
                {status?.n_pdfs ?? 0} PDF · {status?.n_chunks ?? 0} chunks
              </span>
              <button
                onClick={onRefresh}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/[0.06] transition flex items-center gap-1"
              >
                <Icon.Refresh className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto nice-scroll">
            {(!status?.pdfs || status.pdfs.length === 0) ? (
              <div className="h-full grid place-items-center text-center text-white/40 text-[13px] py-12">
                No hay PDFs cargados todavía.
                <br />Sube alguno para comenzar.
              </div>
            ) : (
              <div className="space-y-2">
                {status.pdfs.map((p) => (
                  <div
                    key={p.name}
                    className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition px-3 py-2.5 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/25 grid place-items-center shrink-0">
                      <Icon.Doc className="w-4 h-4 text-red-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate" title={p.name}>{p.name}</div>
                      <div className="text-[11px] text-white/40 font-mono">{bytes(p.size)}</div>
                    </div>
                    <button
                      onClick={() => onDelete(p.name)}
                      className="shrink-0 w-8 h-8 rounded-lg border border-white/10 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 transition grid place-items-center text-white/45"
                      title="Borrar PDF"
                    >
                      <Icon.Trash className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

window.RagView = RagView;
