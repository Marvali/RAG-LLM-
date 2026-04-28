/* ============================================================
   STATS VIEW — Dashboard de estadísticas del índice RAG
   Exporta: window.StatsView

   Datos mock con la misma estructura que los archivos reales
   de output/ (document_stats.csv, faiss_meta.json, etc.)
   para poder conectar la API fácilmente sustituyendo MOCK_*.
============================================================ */
const { useState: _useStateSV, useEffect: _useEffectSV } = React;

const {
  ResponsiveContainer,
  ScatterChart, Scatter,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, LabelList,
} = Recharts;

/* ──────────────────────────────────────────────────────────
   MOCK DATA
   Estructura idéntica a los archivos reales generados por
   el pipeline Python (src/build_index.py + stats export).
   Sustituye con llamadas a /api/stats cuando estén listas.
────────────────────────────────────────────────────────── */

// document_stats.csv → [{documento, n_chunks, n_tokens, n_words, avg_chunk_tokens}, …]
const MOCK_DOC_STATS = [
  { documento: "FIA_F1_2026_Reglamento_Tecnico.pdf",   n_chunks: 148, n_tokens: 74210, n_words: 58340, avg_chunk_tokens: 501 },
  { documento: "FIA_F1_2026_Reglamento_Deportivo.pdf", n_chunks:  96, n_tokens: 48112, n_words: 37890, avg_chunk_tokens: 501 },
  { documento: "FIA_F1_2026_Reglamento_Financiero.pdf",n_chunks:  63, n_tokens: 31560, n_words: 24810, avg_chunk_tokens: 501 },
  { documento: "FIA_Appendix1_Homologation.pdf",       n_chunks:  41, n_tokens: 20530, n_words: 16120, avg_chunk_tokens: 500 },
];

// faiss_meta.json → { n_vectors, dimension, index_type, index_size_bytes, … }
const MOCK_FAISS_META = {
  n_vectors:         348,
  dimension:         384,
  index_type:        "IndexFlatIP",
  index_size_bytes:  2_840_576,
  model:             "all-MiniLM-L6-v2",
};

// pca_embeddings.csv → [{pca_x, pca_y, chunk_id, documento}, …]  (primeras ~200 filas)
const MOCK_PCA = (() => {
  const docs = MOCK_DOC_STATS.map(d => d.documento);
  const colors = ["#ef4444", "#f97316", "#a78bfa", "#38bdf8"];
  const points = [];
  let chunk = 0;
  docs.forEach((doc, di) => {
    const cx = (di - 1.5) * 2.2;
    const cy = (di % 2 === 0 ? 1 : -1) * 1.5;
    for (let i = 0; i < 45; i++) {
      const angle = (i / 45) * 2 * Math.PI;
      const r     = 0.5 + Math.random() * 2.2;
      points.push({
        pca_x:     cx + Math.cos(angle) * r,
        pca_y:     cy + Math.sin(angle) * r,
        chunk_id:  chunk++,
        documento: doc,
        color:     colors[di],
      });
    }
  });
  return points;
})();

// top_vocab.csv → [{word, count}, …] top 10
const MOCK_VOCAB = [
  { word: "artículo",  count: 1842 },
  { word: "reglamento",count: 1234 },
  { word: "equipo",    count:  987 },
  { word: "vehículo",  count:  876 },
  { word: "sistema",   count:  821 },
  { word: "parte",     count:  765 },
  { word: "FIA",       count:  701 },
  { word: "temporada", count:  654 },
  { word: "prueba",    count:  612 },
  { word: "piloto",    count:  589 },
];

// agent_decisions.json → { faiss_retrieval: N, llm_memory: N }
const MOCK_AGENT = [
  { name: "FAISS Retrieval", value: 84, color: "#ef4444" },
  { name: "LLM Memory",      value: 16, color: "#a78bfa" },
];

/* ──────────────────────────────────────────────────────────
   COLORES por documento (para el scatter)
────────────────────────────────────────────────────────── */
const DOC_COLORS = ["#ef4444", "#f97316", "#a78bfa", "#38bdf8"];
const DOC_NAMES  = MOCK_DOC_STATS.map(d => d.documento);

/* ──────────────────────────────────────────────────────────
   KPI CARD
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

/* ──────────────────────────────────────────────────────────
   CHART CARD wrapper
────────────────────────────────────────────────────────── */
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
  const shortDoc = d.documento.replace(".pdf", "").slice(0, 35);
  return (
    <div className="rounded-xl bg-black/85 border border-white/15 px-3 py-2 text-[11.5px] font-mono shadow-2xl">
      <div className="text-white/80">chunk <span className="text-red-300">#{d.chunk_id}</span></div>
      <div className="text-white/50 mt-0.5 truncate max-w-[200px]">{shortDoc}…</div>
      <div className="text-white/35 mt-0.5">
        x: {d.pca_x.toFixed(3)} · y: {d.pca_y.toFixed(3)}
      </div>
    </div>
  );
}

function BarTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-black/85 border border-white/15 px-3 py-2 text-[11.5px] font-mono shadow-2xl">
      <div className="text-white/80">{payload[0].payload.word}</div>
      <div className="text-red-300 font-semibold">{payload[0].value.toLocaleString()} ocurrencias</div>
    </div>
  );
}

function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-xl bg-black/85 border border-white/15 px-3 py-2 text-[11.5px] font-mono shadow-2xl">
      <div style={{ color: d.payload.color }} className="font-semibold">{d.name}</div>
      <div className="text-white/70 mt-0.5">{d.value}% de las consultas</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   STATS VIEW principal
────────────────────────────────────────────────────────── */
function StatsView() {
  // Agrega aquí un useEffect para cargar datos reales desde la API
  // cuando esté lista: GET /api/stats  → { doc_stats, faiss_meta, pca, vocab, agent }

  /* KPIs derivados de los datos mock */
  const totalDocs    = MOCK_DOC_STATS.length;
  const totalChunks  = MOCK_DOC_STATS.reduce((s, d) => s + d.n_chunks, 0);
  const totalTokens  = MOCK_DOC_STATS.reduce((s, d) => s + d.n_tokens, 0);
  const totalWords   = MOCK_DOC_STATS.reduce((s, d) => s + d.n_words, 0);
  const avgChunk     = Math.round(totalTokens / totalChunks);

  /* Vocab ordenado de mayor a menor */
  const vocabSorted = [...MOCK_VOCAB].sort((a, b) => b.count - a.count);

  /* Grupos de scatter por documento */
  const scatterGroups = DOC_NAMES.map((doc, i) => ({
    doc,
    color: DOC_COLORS[i],
    data: MOCK_PCA.filter(p => p.documento === doc),
  }));

  return (
    <div className="h-full overflow-y-auto nice-scroll px-4 py-5 md:px-8 md:py-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-5">

        {/* ── Encabezado ── */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.35em] text-white/35 mb-1">Dashboard</div>
          <h2 className="text-[20px] font-bold text-white/95">Estadísticas del índice RAG</h2>
          <p className="text-[12.5px] text-white/40 mt-0.5">
            Datos del último índice FAISS generado · {MOCK_DOC_STATS.length} documentos indexados
          </p>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            icon="📄"
            label="Documentos"
            value={totalDocs}
            sub="PDFs indexados"
            accent="red"
          />
          <KpiCard
            icon="🧩"
            label="Chunks"
            value={totalChunks.toLocaleString()}
            sub="Fragmentos FAISS"
            accent="orange"
          />
          <KpiCard
            icon="🔤"
            label="Tokens"
            value={(totalTokens / 1000).toFixed(1) + "k"}
            sub="Total tokenizados"
            accent="violet"
          />
          <KpiCard
            icon="📝"
            label="Palabras"
            value={(totalWords / 1000).toFixed(1) + "k"}
            sub="Total en corpus"
            accent="sky"
          />
          <KpiCard
            icon="⚖️"
            label="Avg Chunk"
            value={avgChunk}
            sub="tokens por chunk"
            accent="emerald"
          />
        </div>

        {/* ── Fila media: Scatter PCA + Pie Agente ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Scatter PCA (2/3) */}
          <ChartCard
            title="Mapa Semántico del FAISS"
            subtitle="Proyección PCA 2D de los embeddings del índice · cada punto es un chunk"
            className="lg:col-span-2"
          >
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="pca_x"
                  type="number"
                  tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  label={{ value: "PC 1", position: "insideBottomRight", offset: -4, fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
                />
                <YAxis
                  dataKey="pca_y"
                  type="number"
                  tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                  label={{ value: "PC 2", angle: -90, position: "insideLeft", offset: 10, fill: "rgba(255,255,255,0.25)", fontSize: 10 }}
                />
                <Tooltip content={<ScatterTip />} cursor={{ stroke: "rgba(255,255,255,0.15)" }} />
                <Legend
                  formatter={(v) => (
                    <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}>
                      {v.replace(".pdf", "").slice(0, 28) + "…"}
                    </span>
                  )}
                  iconSize={8}
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 8 }}
                />
                {scatterGroups.map(({ doc, color, data }) => (
                  <Scatter
                    key={doc}
                    name={doc}
                    data={data}
                    fill={color}
                    opacity={0.75}
                    r={3}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Pie Agente (1/3) */}
          <ChartCard
            title="Decisiones del Agente"
            subtitle="Cómo responde el modelo: RAG vs conocimiento propio"
          >
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={MOCK_AGENT}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={88}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {MOCK_AGENT.map((entry, i) => (
                    <Cell key={i} fill={entry.color} opacity={0.85} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="inside"
                    formatter={(v) => `${v}%`}
                    style={{ fill: "rgba(255,255,255,0.90)", fontSize: 13, fontWeight: 700 }}
                  />
                </Pie>
                <Tooltip content={<PieTip />} />
              </PieChart>
            </ResponsiveContainer>

            {/* Leyenda manual para mejor control visual */}
            <div className="flex flex-col gap-2 mt-1">
              {MOCK_AGENT.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="text-[12px] text-white/65 flex-1">{d.name}</span>
                  <span className="text-[12px] font-semibold" style={{ color: d.color }}>
                    {d.value}%
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        {/* ── Vocabulario (barra horizontal, ancho completo) ── */}
        <ChartCard
          title="Top Vocabulario del Dominio"
          subtitle="Las 10 palabras más frecuentes en el corpus (excluidas stopwords)"
        >
          <ResponsiveContainer width="100%" height={270}>
            <BarChart
              data={vocabSorted}
              layout="vertical"
              margin={{ top: 0, right: 40, bottom: 0, left: 70 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis
                type="number"
                tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}
              />
              <YAxis
                type="category"
                dataKey="word"
                tick={{ fill: "rgba(255,255,255,0.60)", fontSize: 11.5 }}
                tickLine={false}
                axisLine={false}
                width={65}
              />
              <Tooltip content={<BarTip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {vocabSorted.map((_, i) => (
                  <Cell
                    key={i}
                    fill={`rgba(239, 68, 68, ${1 - i * 0.072})`}
                  />
                ))}
                <LabelList
                  dataKey="count"
                  position="right"
                  formatter={(v) => v.toLocaleString()}
                  style={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
                {MOCK_DOC_STATS.map((d, i) => (
                  <tr
                    key={i}
                    className="border-b border-white/[0.04] hover:bg-white/[0.03] transition"
                  >
                    <td className="py-2.5 pr-4 text-white/75 font-mono truncate max-w-[260px]" title={d.documento}>
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: DOC_COLORS[i] }}
                        />
                        {d.documento.replace(".pdf", "")}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-white/55">{d.n_chunks}</td>
                    <td className="py-2.5 px-3 text-right text-white/55">{d.n_tokens.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right text-white/55">{d.n_words.toLocaleString()}</td>
                    <td className="py-2.5 pl-3 text-right text-emerald-300/80">{d.avg_chunk_tokens}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-white/50 font-semibold">
                  <td className="pt-3 pr-4 text-white/45 text-[11px] uppercase tracking-wider">Total</td>
                  <td className="pt-3 px-3 text-right">{totalChunks}</td>
                  <td className="pt-3 px-3 text-right">{totalTokens.toLocaleString()}</td>
                  <td className="pt-3 px-3 text-right">{totalWords.toLocaleString()}</td>
                  <td className="pt-3 pl-3 text-right text-emerald-300/80">{avgChunk} avg</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </ChartCard>

        {/* ── FAISS meta ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4">
          {[
            { label: "Vectores FAISS", value: MOCK_FAISS_META.n_vectors.toLocaleString(), icon: "🗄️" },
            { label: "Dimensión",      value: MOCK_FAISS_META.dimension,                  icon: "📐" },
            { label: "Tipo índice",    value: MOCK_FAISS_META.index_type,                 icon: "⚙️" },
            { label: "Tamaño índice",  value: bytes(MOCK_FAISS_META.index_size_bytes),    icon: "💾" },
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

      </div>
    </div>
  );
}

window.StatsView = StatsView;
