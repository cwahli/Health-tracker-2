import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('Extracting dependency graph with madge...');
let rawJson;
const tmpJson = '/tmp/madge_all_src.json';

if (fs.existsSync(tmpJson)) {
  rawJson = fs.readFileSync(tmpJson, 'utf-8');
} else {
  rawJson = execSync('npx -y madge --extensions ts,tsx --json src', {
    cwd: rootDir,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

const graph = JSON.parse(rawJson);
const allFiles = Object.keys(graph);

// Calculate in-degrees (dependents)
const inDegrees = {};
allFiles.forEach(f => { inDegrees[f] = 0; });
allFiles.forEach(src => {
  (graph[src] || []).forEach(dst => {
    if (inDegrees[dst] !== undefined) {
      inDegrees[dst] = (inDegrees[dst] || 0) + 1;
    } else {
      inDegrees[dst] = 1;
    }
  });
});

// Known circulars
const circularFiles = new Set([
  'utils/bugWorkItem.ts',
  'utils/bugTapeReview.ts',
  'jobs/JobStore.ts',
  'jobs/SupabaseJobSync.ts',
  'components/chat-cards/FoodCard.tsx',
  'components/chat-cards/FoodScoutItemPreview.tsx',
]);

function getGroup(file) {
  if (circularFiles.has(file)) return 'circular';
  if (file.startsWith('components/chat-cards/')) return 'chat-cards';
  if (file.startsWith('components/bugQueue/')) return 'bug-queue';
  if (file.startsWith('components/')) return 'components';
  if (file.startsWith('jobs/')) return 'jobs';
  if (file.startsWith('mealBuild/')) return 'meal-build';
  if (file.startsWith('utils/')) return 'utils';
  if (file.startsWith('../server') || file.startsWith('../') || file.startsWith('server/')) return 'server';
  return 'core';
}

const colorMap = {
  'circular': { background: '#ef4444', border: '#b91c1c' },
  'chat-cards': { background: '#818cf8', border: '#4f46e5' },
  'bug-queue': { background: '#f59e0b', border: '#d97706' },
  'components': { background: '#38bdf8', border: '#0284c7' },
  'jobs': { background: '#34d399', border: '#059669' },
  'meal-build': { background: '#fb923c', border: '#ea580c' },
  'utils': { background: '#a78bfa', border: '#7c3aed' },
  'server': { background: '#f43f5e', border: '#e11d48' },
  'core': { background: '#94a3b8', border: '#475569' },
};

const nodes = allFiles.map(file => {
  const inCount = inDegrees[file] || 0;
  const outCount = (graph[file] || []).length;
  const group = getGroup(file);
  const size = Math.min(45, Math.max(12, 12 + Math.sqrt(inCount + outCount) * 4));

  return {
    id: file,
    label: path.basename(file),
    title: `${file}\nImports: ${outCount} files\nImported by: ${inCount} files`,
    group,
    inCount,
    outCount,
    size,
    color: colorMap[group] || colorMap['core'],
    font: { color: '#f8fafc', size: 12, face: 'Inter, system-ui, sans-serif' },
    shape: group === 'circular' ? 'diamond' : 'dot',
  };
});

const edges = [];
allFiles.forEach(src => {
  (graph[src] || []).forEach(dst => {
    const isCirc = circularFiles.has(src) && circularFiles.has(dst);
    edges.push({
      id: `${src}->${dst}`,
      from: src,
      to: dst,
      arrows: { to: { enabled: true, scaleFactor: 0.5 } },
      color: isCirc ? { color: '#ef4444', opacity: 0.9 } : { color: '#475569', opacity: 0.35 },
      width: isCirc ? 2.5 : 1,
    });
  });
});

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Health-Tracker Dependency Graph Visualizer</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; line-height: 1.5; }
    body { background-color: #090d16; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; }
    header { height: 60px; flex-shrink: 0; background: #0f172a; border-bottom: 1px solid #1e293b; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; z-index: 10; }
    .title-group h1 { font-size: 17px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .title-group p { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .controls { display: flex; gap: 8px; align-items: center; }
    input[type="text"] { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 7px 12px; border-radius: 6px; font-size: 13px; width: 230px; outline: none; }
    input[type="text"]:focus { border-color: #38bdf8; }
    button { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 7px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.15s; }
    button:hover { background: #334155; color: #fff; }
    button.active { background: #0284c7; border-color: #38bdf8; color: #fff; font-weight: 600; }
    .badge { padding: 2px 6px; border-radius: 999px; font-size: 11px; font-weight: bold; background: #334155; margin-left: 4px; }
    .badge-red { background: #ef4444; color: #fff; }
    #main-container { height: calc(100vh - 60px); max-height: calc(100vh - 60px); flex: 1; display: flex; overflow: hidden; position: relative; }
    #network { flex: 1; height: 100%; position: relative; }
    #sidebar { width: 350px; flex-shrink: 0; background: #0f172a; border-left: 1px solid #1e293b; padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .legend { background: #1e293b; border-radius: 8px; padding: 12px; font-size: 12px; }
    .legend-title { font-weight: 600; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    .legend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .legend-item { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
    .legend-item:hover { background: #334155; }
    .legend-color { width: 12px; height: 12px; border-radius: 50%; }
    .card { background: #1e293b; border-radius: 8px; padding: 14px; border: 1px solid #334155; }
    .card h3 { font-size: 14px; margin-bottom: 8px; color: #38bdf8; word-break: break-all; }
    .stat-row { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
    .stat-row strong { color: #f1f5f9; }
    .link-list { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin-top: 6px; padding-right: 2px; }
    .link-pill { background: #0f172a; border: 1px solid #1e3a8a; color: #60a5fa; padding: 7px 10px; border-radius: 6px; font-size: 12px; line-height: 1.4; font-weight: 500; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
    .link-pill:hover { border-color: #38bdf8; background: #1e293b; color: #fff; }
    .pill-incoming { color: #34d399; border-color: #065f46; }
    .pill-incoming:hover { border-color: #34d399; background: #064e3b; color: #fff; }
    .quick-stats { display: flex; gap: 8px; font-size: 11px; color: #94a3b8; }
    .stat-chip { background: #1e293b; padding: 4px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <header>
    <div class="title-group">
      <h1>Health-Tracker Dependency Graph <span class="badge badge-red">Interactive</span></h1>
      <p>Pan to move • Scroll to zoom • Click node to inspect upstream & downstream connections</p>
    </div>
    <div class="controls">
      <input type="text" id="search-box" placeholder="Search file (e.g. App.tsx, JobStore)..." />
      <button id="btn-reset" class="active">Reset View</button>
      <button id="btn-app">App.tsx Tree</button>
      <button id="btn-circ">Circular (3) <span class="badge badge-red">!</span></button>
      <button id="btn-physics">Toggle Physics</button>
    </div>
  </header>

  <div id="main-container">
    <div id="network"></div>
    <div id="sidebar">
      <div class="quick-stats">
        <div class="stat-chip">Total Files: <strong>${allFiles.length}</strong></div>
        <div class="stat-chip">Total Links: <strong>${edges.length}</strong></div>
        <div class="stat-chip">Circular: <strong style="color: #ef4444">3</strong></div>
      </div>

      <div id="node-inspector" class="card">
        <h3 id="inspect-name">Select a node</h3>
        <p id="inspect-sub" style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">Click any file node to inspect who imports it and what it imports.</p>
        <div id="inspect-body" style="display: none;">
          <div class="stat-row"><span>Category:</span> <strong id="inspect-cat">-</strong></div>
          <div class="stat-row"><span>Depends on:</span> <strong id="inspect-out-count">0</strong></div>
          <div class="stat-row"><span>Imported by:</span> <strong id="inspect-in-count">0</strong></div>

          <div style="margin-top: 10px;">
            <div class="stat-row"><span>Imports (Dependencies):</span></div>
            <div id="inspect-out-list" class="link-list"></div>
          </div>

          <div style="margin-top: 10px;">
            <div class="stat-row"><span>Imported By (Dependents):</span></div>
            <div id="inspect-in-list" class="link-list"></div>
          </div>
        </div>
      </div>

      <div class="legend">
        <div class="legend-title">Categories & Colors</div>
        <div class="legend-grid">
          <div class="legend-item" onclick="filterCategory('circular')"><div class="legend-color" style="background:#ef4444"></div>Circular Loop</div>
          <div class="legend-item" onclick="filterCategory('components')"><div class="legend-color" style="background:#38bdf8"></div>Components</div>
          <div class="legend-item" onclick="filterCategory('chat-cards')"><div class="legend-color" style="background:#818cf8"></div>Chat Cards</div>
          <div class="legend-item" onclick="filterCategory('jobs')"><div class="legend-color" style="background:#34d399"></div>Jobs & Sync</div>
          <div class="legend-item" onclick="filterCategory('meal-build')"><div class="legend-color" style="background:#fb923c"></div>Meal Build</div>
          <div class="legend-item" onclick="filterCategory('utils')"><div class="legend-color" style="background:#a78bfa"></div>Utils</div>
          <div class="legend-item" onclick="filterCategory('bug-queue')"><div class="legend-color" style="background:#f59e0b"></div>Bug Queue</div>
          <div class="legend-item" onclick="filterCategory('server')"><div class="legend-color" style="background:#f43f5e"></div>Server / Root</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const rawNodes = ${JSON.stringify(nodes)};
    const rawEdges = ${JSON.stringify(edges)};
    const rawGraph = ${JSON.stringify(graph)};

    const container = document.getElementById('network');
    const nodesDataSet = new vis.DataSet(rawNodes);
    const edgesDataSet = new vis.DataSet(rawEdges);

    const data = { nodes: nodesDataSet, edges: edgesDataSet };
    let physicsEnabled = true;

    const options = {
      layout: {
        improvedLayout: false,
      },
      nodes: {
        borderWidth: 1.5,
        scaling: { min: 10, max: 40 },
        shadow: true,
      },
      edges: {
        smooth: { type: 'continuous' },
        selectionWidth: 3,
      },
      physics: {
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: -35,
          centralGravity: 0.005,
          springLength: 85,
          springConstant: 0.12,
          damping: 0.85,
        },
        stabilization: { iterations: 120 },
      },
      interaction: {
        hover: true,
        tooltipDelay: 150,
        multiselect: false,
      }
    };

    const network = new vis.Network(container, data, options);

    network.once('stabilizationIterationsDone', function () {
      network.fit();
    });

    // Inspector
    network.on('click', function(params) {
      if (params.nodes.length > 0) {
        const selectedId = params.nodes[0];
        highlightNode(selectedId);
        showInspector(selectedId);
      } else {
        resetHighlight();
      }
    });

    function highlightNode(nodeId) {
      const nodeObj = rawNodes.find(n => n.id === nodeId);
      if (!nodeObj) return;

      const outDeps = new Set(rawGraph[nodeId] || []);
      const inDeps = new Set();
      Object.keys(rawGraph).forEach(k => {
        if ((rawGraph[k] || []).includes(nodeId)) inDeps.add(k);
      });

      const updatedNodes = rawNodes.map(n => {
        if (n.id === nodeId) {
          return { ...n, color: { background: '#f59e0b', border: '#d97706' }, opacity: 1 };
        }
        if (outDeps.has(n.id)) {
          return { ...n, color: { background: '#38bdf8', border: '#0284c7' }, opacity: 1 };
        }
        if (inDeps.has(n.id)) {
          return { ...n, color: { background: '#34d399', border: '#059669' }, opacity: 1 };
        }
        return { ...n, opacity: 0.12, font: { color: '#334155' } };
      });

      const updatedEdges = rawEdges.map(e => {
        if (e.from === nodeId) {
          return { ...e, color: { color: '#38bdf8', opacity: 1 }, width: 2.5 };
        }
        if (e.to === nodeId) {
          return { ...e, color: { color: '#34d399', opacity: 1 }, width: 2.5 };
        }
        return { ...e, color: { color: '#1e293b', opacity: 0.05 }, width: 0.5 };
      });

      nodesDataSet.update(updatedNodes);
      edgesDataSet.update(updatedEdges);
    }

    function resetHighlight() {
      nodesDataSet.update(rawNodes.map(n => ({ ...n, opacity: 1, font: { color: '#f8fafc' } })));
      edgesDataSet.update(rawEdges);
    }

    function showInspector(nodeId) {
      const nodeObj = rawNodes.find(n => n.id === nodeId);
      if (!nodeObj) return;

      document.getElementById('inspect-name').textContent = nodeId;
      document.getElementById('inspect-sub').textContent = 'Viewing connections:';
      document.getElementById('inspect-body').style.display = 'block';
      document.getElementById('inspect-cat').textContent = nodeObj.group.toUpperCase();
      document.getElementById('inspect-out-count').textContent = nodeObj.outCount;
      document.getElementById('inspect-in-count').textContent = nodeObj.inCount;

      const outList = document.getElementById('inspect-out-list');
      outList.innerHTML = '';
      (rawGraph[nodeId] || []).forEach(dep => {
        const btn = document.createElement('div');
        btn.className = 'link-pill';
        btn.textContent = dep;
        btn.onclick = () => focusNode(dep);
        outList.appendChild(btn);
      });
      if ((rawGraph[nodeId] || []).length === 0) {
        outList.innerHTML = '<span style="font-size:11px;color:#64748b;">No outgoing dependencies</span>';
      }

      const inList = document.getElementById('inspect-in-list');
      inList.innerHTML = '';
      const inNodes = Object.keys(rawGraph).filter(k => (rawGraph[k] || []).includes(nodeId));
      inNodes.forEach(dep => {
        const btn = document.createElement('div');
        btn.className = 'link-pill pill-incoming';
        btn.textContent = dep;
        btn.onclick = () => focusNode(dep);
        inList.appendChild(btn);
      });
      if (inNodes.length === 0) {
        inList.innerHTML = '<span style="font-size:11px;color:#64748b;">No incoming dependents (entrypoint or unused)</span>';
      }
    }

    function focusNode(nodeId) {
      network.focus(nodeId, { scale: 1.0, animation: { duration: 600, easingFunction: 'easeInOutQuad' } });
      highlightNode(nodeId);
      showInspector(nodeId);
    }

    // Search
    document.getElementById('search-box').addEventListener('input', function(e) {
      const val = e.target.value.toLowerCase().trim();
      if (!val) {
        resetHighlight();
        return;
      }
      const match = rawNodes.find(n => n.id.toLowerCase().includes(val) || n.label.toLowerCase().includes(val));
      if (match) {
        focusNode(match.id);
      }
    });

    // Reset button
    document.getElementById('btn-reset').addEventListener('click', () => {
      resetHighlight();
      network.fit({ animation: { duration: 500 } });
      document.getElementById('inspect-body').style.display = 'none';
      document.getElementById('inspect-name').textContent = 'Select a node';
      document.getElementById('inspect-sub').textContent = 'Click any file node to inspect who imports it and what it imports.';
    });

    // Circular button
    document.getElementById('btn-circ').addEventListener('click', () => {
      const circSet = new Set(['utils/bugWorkItem.ts', 'utils/bugTapeReview.ts', 'jobs/JobStore.ts', 'jobs/SupabaseJobSync.ts', 'components/chat-cards/FoodCard.tsx', 'components/chat-cards/FoodScoutItemPreview.tsx']);
      const updatedNodes = rawNodes.map(n => {
        if (circSet.has(n.id)) {
          return { ...n, opacity: 1 };
        }
        return { ...n, opacity: 0.08 };
      });
      nodesDataSet.update(updatedNodes);
      network.fit({ nodes: Array.from(circSet), animation: { duration: 600 } });
    });

    // App tree button
    document.getElementById('btn-app').addEventListener('click', () => {
      focusNode('App.tsx');
    });

    // Toggle physics
    document.getElementById('btn-physics').addEventListener('click', () => {
      physicsEnabled = !physicsEnabled;
      network.setOptions({ physics: { enabled: physicsEnabled } });
      document.getElementById('btn-physics').textContent = physicsEnabled ? 'Freeze Physics' : 'Enable Physics';
    });

    function filterCategory(group) {
      const groupNodes = rawNodes.filter(n => n.group === group).map(n => n.id);
      if (groupNodes.length > 0) {
        const updatedNodes = rawNodes.map(n => ({
          ...n,
          opacity: n.group === group ? 1 : 0.08
        }));
        nodesDataSet.update(updatedNodes);
        network.fit({ nodes: groupNodes, animation: { duration: 600 } });
      }
    }
  </script>
</body>
</html>`;

const outPath = path.resolve(rootDir, 'dependency-graph.html');
fs.writeFileSync(outPath, htmlContent, 'utf-8');
console.log('Successfully generated interactive dependency graph at: ' + outPath);
