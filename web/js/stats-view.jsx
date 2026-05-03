/* ============================================================
   STATS VIEW — Dashboard de estadísticas del índice RAG
   Exporta: window.StatsView

   Carga datos reales desde GET /api/stats. Si Recharts no está
   disponible (CDN bloqueado, etc.) o el backend aún no tiene
   índice, muestra un fallback en lugar de crashear el tab.
============================================================ */
const { useState: _useStateSV, useEffect: _useEffectSV, useMemo: _useMemoSV } = React;

/* ──────────────────────────────────────────────────────────
   Recharts en modo defensivo
   Si window.Recharts no existe, exponemos stubs que renderizan
   un mensaje en vez de explotar al destructurar.
────────────────────────────────────────────────────────── */
const _R = (typeof window !== "undefined" && window.Recharts) ? window.Recharts : null;
const RECHARTS_OK = !!_R;

function _missingChart() {
  return (
    <div className="h-full w-full grid place-items-center text-[12px] text-white/45 px-4 text-center">
      Gráficas deshabilitadas: no se pudo cargar Recharts (revisa la conexión a unpkg.com).
    </div>
  );
}

const ResponsiveContainer = _R?.ResponsiveContainer || (({ children }) => <div className="h-full">{_missingChart()}</div>);
const ScatterChart  = _R?.ScatterChart  || (() => null);
const Scatter       = _R?.Scatter       || (() => null);
const BarChart      = _R?.BarChart      || (() => null);
const Bar           = _R?.Bar           || (() => null);
const PieChart      = _R?.PieChart      || (() => null);
const Pie           = _R?.Pie           || (() => null);
const Cell          = _R?.Cell          || (() => null);
const XAxis         = _R?.XAxis         || (() => null);
const YAxis         = _R?.YAxis         || (() => null);
const CartesianGrid = _R?.CartesianGrid || (() => null);
const Tooltip       = _R?.Tooltip       || (() => null);
const Legend        = _R?.Legend        || (() => null);
const LabelList     = _R?.LabelList     || (() => null);

/* ──────────────────────────────────────────────────────────
   ErrorBoundary local — si algo dentro de Recharts revienta
   en runtime, no tumbamos toda la pestaña.
────────────────────────────────────────────────────────── */
class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { /* swallow */ }
  render() {
    if (this.state.err) {
      return (
        <div className="h-full w-full grid place-items-center text-[11.5px] text-red-300/80 px-3 text-center">
          No se pudo renderizar la gráfica: {String(this.state.err.message || this.state.err).slice(0, 120)}
        </div>
      );
    }
    return this.props.children;
  }
}

/* ──────────────────────────────────────────────────────────
   KPI / Chart cards
────────────────────────────────────────────────────────── */
function KpiCard({ icon, label, value, sub, accent = "red" }) {
  const accentMap = {
    red:    "from-red-600/20 to-red-800/10 border-red-500/20 text-red-300",
    orange: "from-orange-600/20 to-orange-800/10 border-orange-500/20 text-orange-300",
    violet: "from-violet-600/20 to-violet-800/10 border-violet-500/20 text-violet-300",
    sky:    "from-sky-600/20 to-sky-800/10 border-sky-500/20 text-sky-300",
    emerald:"from-emerald-600/20 to-emerald-800/10 border-emerald-500/20 text-emerald-300",
  };
  return (
    <div className={cls(
      "rounded-2xl border bg-gradient-to-br backdrop-blur-xl p-4 flex flex-col gap-1.5 fade-in",
      accentMap[accent]
    )}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className="text-[10.5px] uppercase tracking-[0.22em] text-white/45">{label}</span>
      </div>
      <div className="text-[26px] font-bold leading-none text-white/95">{value}</div>
      {sub && <div className="text-[11px] text-white/38">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, subtitle, children, className = "" }) {
  return (
    <div className={cls(
      "rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 flex flex-col gap-3 fade-in",
      className
    )}>
      <div>
        <div className="text-[13px] font-semibold text-white/90">{title}</div>
        {subtitle && <div className="text-[11px] text-white/40 mt-0.5">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   CUSTOM TOOLTIPS
────────────────────────────────────────────────────────── */
function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const shortDoc = String(d.documento || "").replace(/\.pdf$/i, "").slice(0, 35);
  return (
    <div className="rounded-xl bg-black/85 border border-white/15 px-3 py-2 text-[11.5px] font-mono shadow-2xl">
      <div className="text-white/80">chunk <span style={{ color: "var(--accent-text)" }}>#{d.chunk_id}</span></div>
      <div className="text-white/50 mt-0.5 truncate max-w-[200px]">{shortDoc}…</div>
      <div className="text-white/35 mt-0.5">
        x: {Number(d.pca_x).toFixed(3)} · y: {Number(d.pca_y).toFixed(3)}
      </div>
    </div>
  );
}

function BarTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0].value || 0);
  return (
    <div className="rounded-xl bg-black/85 border border-white/15 px-3 py-2 text-[11.5px] font-mono shadow-2xl">
      <div className="text-white/80">{payload[0].payload.word}</div>
      <div className="font-semibold" style={{ color: "var(--accent-text)" }}>{v.toLocaleString()} ocurrencias</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   STATS VIEW principal — datos reales desde /api/stats
────────────────────────────────────────────────────────── */
function StatsView() {
  const [data,    setData]    = _useStateSV(null);
  const [loading, setLoading] = _useStateSV(true);
  const [error,   setError]   = _useStateSV(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const s = await apiGet("/api/stats");
      setData(s);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  _useEffectSV(() => { load(); }, []);

  /* ── Datos derivados (siempre calculados — antes de los early returns
        para no violar las Rules of Hooks de React) ── */
  const docStats   = data?.doc_stats || [];
  const totals     = data?.totals    || { n_docs: 0, n_chunks: 0, n_tokens: 0, n_words: 0, avg_chunk_tokens: 0 };
  const faissMeta  = data?.faiss_meta;
  const vocab      = (data?.vocab || []).slice().sort((a, b) => b.count - a.count);
  const pcaPoints  = data?.pca || [];

  const scatterGroups = _useMemoSV(() => {
    const byDoc = new Map();
    for (const p of pcaPoints) {
      if (!byDoc.has(p.documento)) byDoc.set(p.documento, []);
      byDoc.get(p.documento).push(p);
    }
    return Array.from(byDoc.entries()).map(([doc, points]) => ({
      doc,
      color: points[0]?.color || "#94a3b8",
      data: points,
    }));
  }, [pcaPoints]);

  /* ── Estados especiales ── */
  if (loading) {
    return (
      <div className="h-full grid place-items-center text-[13px] text-white/40">
        Cargando estadísticas…
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full grid place-items-center px-6">
        <div className="max-w-md text-center">
          <div className="text-[13px] text-red-300/90 mb-2">No se pudieron cargar las estadísticas</div>
          <div className="text-[11.5px] text-white/40 font-mono break-words mb-4">{error}</div>
          <button
            onClick={load}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/[0.06] text-white/75 transition"
          >Reintentar</button>
        </div>
      </div>
    );
  }

  if (!data || !data.ready) {
    return (
      <div className="h-full grid place-items-center px-6">
        <div className="max-w-md text-center text-[12.5px] text-white/55 leading-relaxed">
          Aún no hay un índice RAG generado.<br/>
          Ve a la pestaña <strong>Documentos</strong>, sube algún PDF y pulsa <strong>“Regenerar RAG”</strong>;
          luego vuelve aquí para ver el dashboard con datos reales.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto nice-scroll px-4 py-5 md:px-8 md:py-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-5">

        {/* ── Encabezado ── */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.35em] text-white/35 mb-1">Dashboard</div>
            <h2 className="text-[20px] font-bold text-white/95">Estadísticas del índice RAG</h2>
            <p className="text-[12.5px] text-white/40 mt-0.5">
              Datos del último índice FAISS generado · {totals.n_docs} documento{totals.n_docs === 1 ? "" : "s"} indexado{totals.n_docs === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={load}
            className="text-[12px] px-3 py-1.5 rounded-lg border border-white/15 hover:bg-white/[0.06] text-white/65 hover:text-white transition shrink-0"
            title="Recargar /api/stats"
          >Refrescar</button>
        </div>

        {!RECHARTS_OK && (
          <div className="text-[11.5px] rounded-xl border border-amber-400/25 bg-amber-400/10 text-amber-200/90 px-3 py-2">
            Las gráficas no se pudieron cargar (Recharts no disponible). El resto del dashboard funciona con normalidad.
          </div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard icon="📄" label="Documentos" value={totals.n_docs}
            sub="PDFs indexados" accent="red" />
          <KpiCard icon="🧩" label="Chunks" value={(totals.n_chunks || 0).toLocaleString()}
            sub="Fragmentos FAISS" accent="orange" />
          <KpiCard icon="🔤" label="Tokens"
            value={totals.n_tokens >= 1000 ? (totals.n_tokens / 1000).toFixed(1) + "k" : totals.n_tokens}
            sub="Total tokenizados" accent="violet" />
          <KpiCard icon="📝" label="Palabras"
            value={totals.n_words >= 1000 ? (totals.n_words / 1000).toFixed(1) + "k" : totals.n_words}
            sub="Total en corpus" accent="sky" />
          <KpiCard icon="⚖️" label="Avg Chunk" value={totals.avg_chunk_tokens || 0}
            sub="tokens por chunk" accent="emerald" />
        </div>

        {/* ── Scatter PCA + Pie Top Docs ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Scatter PCA */}
          <ChartCard
            title="Mapa Semántico del FAISS"
            subtitle={
              pcaPoints.length
                ? `Proyección PCA 2D · ${pcaPoints.length} chunk(s) mostrado(s)`
                : "PCA no disponible (regenera el índice para producir embeddings.npy)"
            }
            className="lg:col-span-2"
          >
            <div style={{ height: 320 }}>
              {(RECHARTS_OK && pcaPoints.length > 0) ? (
                <ChartErrorBoundary>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="pca_x" type="number"
                        tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                        tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                      <YAxis dataKey="pca_y" type="number"
                        tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                        tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
                      <Tooltip content={<ScatterTip />} cursor={{ stroke: "rgba(255,255,255,0.15)" }} />
                      <Legend
                        formatter={(v) => (
                          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}>
                            {String(v).replace(/\.pdf$/i, "").slice(0, 28)}
                          </span>
                        )}
                        iconSize={8} iconType="circle" wrapperStyle={{ paddingTop: 8 }}
                      />
                      {scatterGroups.map(({ doc, color, data }) => (
                        <Scatter key={doc} name={doc} data={data} fill={color} opacity={0.75} />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </ChartErrorBoundary>
              ) : (
                <div className="h-full grid place-items-center text-[12px] text-white/40 text-center px-4">
                  {pcaPoints.length === 0
                    ? "No hay datos PCA todavía. Regenera el índice para generar output/embeddings.npy."
                    : "Recharts no disponible."}
                </div>
              )}
            </div>
          </ChartCard>

          {/* Distribución de chunks por documento (pie) */}
          <ChartCard
            title="Distribución de Chunks"
            subtitle="Reparto de fragmentos por documento"
          >
            <div style={{ height: 220 }}>
              {(RECHARTS_OK && docStats.length > 0) ? (
                <ChartErrorBoundary>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={docStats.map(d => ({ name: d.documento, value: d.n_chunks, color: d.color }))}
                        cx="50%" cy="50%"
                        innerRadius={50} outerRadius={84}
                        paddingAngle={3} dataKey="value" stroke="none"
                      >
                        {docStats.map((d, i) => (
                          <Cell key={i} fill={d.color || "#94a3b8"} opacity={0.85} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "rgba(0,0,0,0.85)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 12,
                          fontSize: 11.5,
                        }}
                        labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartErrorBoundary>
              ) : (
                <div className="h-full grid place-items-center text-[12px] text-white/40">Sin datos</div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 mt-1 max-h-[140px] overflow-y-auto nice-scroll pr-1">
              {docStats.map((d) => (
                <div key={d.documento} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color || "#94a3b8" }} />
                  <span className="text-[11.5px] text-white/65 flex-1 truncate" title={d.documento}>
                    {d.documento.replace(/\.pdf$/i, "")}
                  </span>
                  <span className="text-[11.5px] font-semibold text-white/80">{d.n_chunks}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        {/* ── Top vocabulario ── */}
        <ChartCard
          title="Top Vocabulario del Dominio"
          subtitle="Las palabras más frecuentes en el corpus (excluidas stopwords)"
        >
          <div style={{ height: 270 }}>
            {(RECHARTS_OK && vocab.length > 0) ? (
              <ChartErrorBoundary>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={vocab} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 70 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number"
                      tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                      tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                      tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                    <YAxis type="category" dataKey="word"
                      tick={{ fill: "rgba(255,255,255,0.60)", fontSize: 11.5 }}
                      tickLine={false} axisLine={false} width={65} />
                    <Tooltip content={<BarTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {vocab.map((_, i) => (
                        <Cell key={i}
                          fill={getComputedStyle(document.documentElement).getPropertyValue('--accent-mid').trim() || '#ef4444'}
                          fillOpacity={Math.max(0.3, 1 - i * 0.072)} />
                      ))}
                      <LabelList dataKey="count" position="right"
                        formatter={(v) => Number(v).toLocaleString()}
                        style={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartErrorBoundary>
            ) : (
              <div className="h-full grid place-items-center text-[12px] text-white/40">
                {vocab.length === 0 ? "Vocabulario aún no calculado." : "Recharts no disponible."}
              </div>
            )}
          </div>
        </ChartCard>

        {/* ── Tabla de documentos ── */}
        <ChartCard
          title="Desglose por Documento"
          subtitle="Detalle de chunks, tokens y palabras de cada PDF indexado"
        >
          <div className="overflow-x-auto nice-scroll">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-[0.18em] text-white/35">
                  <th className="text-left pb-2 pr-4">Documento</th>
                  <th className="text-right pb-2 px-3">Chunks</th>
                  <th className="text-right pb-2 px-3">Tokens</th>
                  <th className="text-right pb-2 px-3">Palabras</th>
                  <th className="text-right pb-2 pl-3">Avg tok/chunk</th>
                </tr>
              </thead>
              <tbody>
                {docStats.map((d, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition">
                    <td className="py-2.5 pr-4 text-white/75 font-mono truncate max-w-[260px]" title={d.documento}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color || "#94a3b8" }} />
                        {d.documento.replace(/\.pdf$/i, "")}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-white/55">{d.n_chunks}</td>
                    <td className="py-2.5 px-3 text-right text-white/55">{(d.n_tokens || 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-white/55">{(d.n_words || 0).toLocaleString()}</td>
                    <td className="py-2.5 pl-3 text-right text-emerald-300/80">{d.avg_chunk_tokens}</td>
                  </tr>
                ))}
                {docStats.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-white/40 text-[12px]">
                    Sin documentos indexados.
                  </td></tr>
                )}
              </tbody>
              {docStats.length > 0 && (
                <tfoot>
                  <tr className="text-white/50 font-semibold">
                    <td className="pt-3 pr-4 text-white/45 text-[11px] uppercase tracking-wider">Total</td>
                    <td className="pt-3 px-3 text-right">{totals.n_chunks}</td>
                    <td className="pt-3 px-3 text-right">{(totals.n_tokens || 0).toLocaleString()}</td>
                    <td className="pt-3 px-3 text-right">{(totals.n_words || 0).toLocaleString()}</td>
                    <td className="pt-3 pl-3 text-right text-emerald-300/80">{totals.avg_chunk_tokens} avg</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </ChartCard>

        {/* ── FAISS meta ── */}
        {faissMeta && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4">
            {[
              { label: "Vectores FAISS", value: (faissMeta.n_vectors || 0).toLocaleString(), icon: "🗄️" },
              { label: "Dimensión",      value: faissMeta.dimension,                          icon: "📐" },
              { label: "Tipo índice",    value: faissMeta.index_type,                         icon: "⚙️" },
              { label: "Tamaño índice",  value: bytes(faissMeta.index_size_bytes),            icon: "💾" },
            ].map(({ label, value, icon }) => (
              <div key={label}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center gap-3 fade-in"
              >
                <span className="text-lg">{icon}</span>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</div>
                  <div className="text-[14px] font-semibold text-white/85 font-mono">{value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

window.StatsView = StatsView;
