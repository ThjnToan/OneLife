/**
 * OneLife - Personal Management System
 * Frontend Application
 */

const API_BASE = '';

// ==================== UTILITIES ====================

async function api(endpoint, options = {}) {
    const url = `${API_BASE}/api${endpoint}`;
    const defaults = {
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    const response = await fetch(url, { ...defaults, ...options });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    if (response.status === 204) return null;
    return response.json();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getBezierPath(points) {
    if (points.length < 2) return '';
    let path = `M ${points[0].x} ${points[0].y}`;
    const dx = (points[1].x - points[0].x) / 3;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i+1];
        path += ` C ${p0.x + dx} ${p0.y}, ${p1.x - dx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return path;
}

function buildSparkline(values, color = 'var(--g-blue)') {
    if (!values || values.length < 2) return '';
    const W = 100, H = 24, pad = 2;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (W - pad * 2) / (values.length - 1);
    const sy = v => pad + (H - pad * 2) * (1 - (v - min) / range);
    const pts = values.map((v, i) => ({ x: pad + i * stepX, y: sy(v) }));
    const bezierPath = getBezierPath(pts);
    const areaPath = `${bezierPath} L ${pts[pts.length - 1].x} ${H - pad} L ${pts[0].x} ${H - pad} Z`;
    const last = values[values.length - 1];
    return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path d="${areaPath}" fill="${color}" opacity="0.12"/>
        <path d="${bezierPath}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${pts[pts.length - 1].x}" cy="${sy(last)}" r="1.8" fill="${color}"/>
    </svg>`;
}

function renderHeatmap(cells, containerId = 'heatmapContainer', opts = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!cells || cells.length === 0) {
        const msg = opts.empty || 'No activity yet';
        container.innerHTML = `<div class="empty-state-compact" style="text-align:center;color:var(--c-text3);font-size:.8125rem;padding:18px 0">${msg}</div>`;
        return;
    }
    const cols = Math.ceil(cells.length / 7);
    const cellsByCol = [];
    for (let c = 0; c < cols; c++) {
        const col = cells.slice(c * 7, c * 7 + 7);
        while (col.length < 7) col.push({ level: -1 });
        cellsByCol.push(col);
    }
    const today = new Date().toISOString().split('T')[0];
    const monthLabels = [];
    let lastMonth = -1;
    cellsByCol.forEach((col, ci) => {
        const firstCell = col.find(c => c.level >= 0);
        if (firstCell) {
            const m = new Date(firstCell.date).getMonth();
            if (m !== lastMonth) {
                monthLabels.push({ idx: ci, name: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m] });
                lastMonth = m;
            }
        }
    });
    container.innerHTML = `
        <div class="heatmap-labels">${monthLabels.map(m => `<span style="grid-column:${m.idx+1}">${m.name}</span>`).join('')}</div>
        <div class="heatmap${opts.steps ? ' heatmap-steps' : ''}">
            ${cellsByCol.map(col => `<div class="heatmap-col">${col.map(c =>
                c.level < 0 ? '<div class="heatmap-cell" style="visibility:hidden"></div>'
                : `<div class="heatmap-cell heatmap-l${c.level}" title="${c.date}: ${(c.count||0).toLocaleString()} ${opts.unit || 'activities'}"></div>`
            ).join('')}</div>`).join('')}
        </div>
        ${opts.legend ? `
            <div class="heatmap-legend${opts.steps ? ' heatmap-legend-steps' : ''}">
                <span>${opts.legendLabel || 'Less'}</span>
                <div class="heatmap-cell heatmap-l0"></div>
                <div class="heatmap-cell heatmap-l1"></div>
                <div class="heatmap-cell heatmap-l2"></div>
                <div class="heatmap-cell heatmap-l3"></div>
                <div class="heatmap-cell heatmap-l4"></div>
                <span>${opts.legendLabelMore || 'More'}</span>
            </div>
        ` : ''}
    `;
}

function buildDelta(curr, prev) {
    if (!prev && prev !== 0) return { html: '', direction: 'flat' };
    if (prev === 0) return { html: '', direction: 'flat' };
    const change = curr - prev;
    const pct = (change / prev) * 100;
    const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
    const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '·';
    const absCompact = formatCompact(Math.abs(change));
    return {
        html: `<span class="delta-pill ${dir}">${arrow} ${absCompact}</span><span class="delta-context">${Math.abs(pct).toFixed(1)}%</span>`,
        direction: dir
    };
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency', currency: 'VND'
    }).format(amount || 0);
}

function fmtVnd(amount) {
    return `${formatNumber(amount)}<span class="vnd-unit">₫</span>`;
}

function fmtVndPlain(amount) {
    return `${formatNumber(amount || 0)} ₫`;
}

function formatNumber(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount || 0);
}

function formatCompact(amount) {
    const n = Math.abs(amount || 0);
    if (n >= 1e9) return (amount >= 0 ? '' : '-') + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (amount >= 0 ? '' : '-') + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (amount >= 0 ? '' : '-') + (n / 1e3).toFixed(0) + 'K';
    return (amount || 0).toString();
}

function formatCurrencyShort(amount) {
    const n = amount || 0;
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return n.toString();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function getFileIcon(type) {
    if (!type) return '📄';
    const t = type.toLowerCase();
    if (t.includes('pdf')) return '📕';
    if (t.includes('image') || t.includes('png') || t.includes('jpg') || t.includes('jpeg') || t.includes('gif')) return '🖼️';
    if (t.includes('video') || t.includes('mp4')) return '🎬';
    if (t.includes('audio') || t.includes('mp3')) return '🎵';
    if (t.includes('spreadsheet') || t.includes('xls')) return '📊';
    if (t.includes('word') || t.includes('doc')) return '📝';
    if (t.includes('zip') || t.includes('archive')) return '📦';
    return '📄';
}

// Modal
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalClose = document.getElementById('modalClose');

function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalOverlay.classList.add('active');
    modalOverlay.setAttribute('role', 'dialog');
    modalOverlay.setAttribute('aria-modal', 'true');
    attachBlurValidation(modalBody);
}

function attachBlurValidation(root) {
    const inputs = root.querySelectorAll('input[required], textarea[required], select[required]');
    inputs.forEach(input => {
        if (input.dataset.bound === '1') return;
        input.dataset.bound = '1';
        const validate = () => {
            const ok = input.checkValidity() && (input.value || '').trim().length > 0;
            input.classList.toggle('input-success', ok);
            input.classList.toggle('input-error', !ok && input.dataset.touched === '1');
            let msg = input.parentElement.querySelector('.input-msg');
            if (!ok && input.dataset.touched === '1') {
                if (!msg) {
                    msg = document.createElement('div');
                    msg.className = 'input-msg';
                    input.parentElement.appendChild(msg);
                }
                msg.textContent = input.validationMessage || 'Required';
            } else if (msg) {
                msg.remove();
            }
        };
        input.addEventListener('blur', () => { input.dataset.touched = '1'; validate(); });
        input.addEventListener('input', () => { if (input.dataset.touched === '1') validate(); });
    });
}

function closeModal() {
    modalOverlay.classList.remove('active');
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (modalOverlay.classList.contains('active')) closeModal();
        if (cmdOverlay && cmdOverlay.classList.contains('active')) toggleCmdPalette();
    }
});

// Toast
function showToast(message, type = 'success', options = {}) {
    const container = document.querySelector('.toast-container') || (() => {
        const c = document.createElement('div');
        c.className = 'toast-container';
        document.body.appendChild(c);
        return c;
    })();

    const colors = { success: '#34A853', error: '#EA4335', warning: '#FBBC05', info: '#4285F4' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    const icons = {
        success: '<path d="M20 6L9 17l-5-5"/>',
        error: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
    };
    const undoHtml = options.undo
        ? `<button class="toast-undo" aria-label="Undo">Undo</button>`
        : '';
    toast.innerHTML = `
        <svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icons[type] || icons.success}</svg>
        <span>${escapeHtml(message)}</span>
        ${undoHtml}
        <button class="toast-close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
    toast.style.borderLeft = `4px solid ${colors[type] || colors.success}`;
    if (options.undo) {
        const undoBtn = toast.querySelector('.toast-undo');
        undoBtn.addEventListener('click', () => {
            try { options.undo(); } catch (e) { console.error(e); }
            toast.remove();
        });
    }
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);

    const duration = options.duration || 5000;
    const timer = setTimeout(() => dismissToast(toast), duration);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
}

function dismissToast(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
}

// ==================== DARK MODE ====================

function initTheme() {
    const saved = localStorage.getItem('onelife-theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    
    document.getElementById('themeToggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('onelife-theme', next);
    });
}

// ==================== COMMAND PALETTE ====================

const cmdOverlay = document.getElementById('cmdPaletteOverlay');
const cmdInput = document.getElementById('cmdPaletteInput');
const cmdResults = document.getElementById('cmdPaletteResults');
let cmdItems = [];
let cmdSelectedIndex = -1;
let cmdTimeout = null;

function openCmdPalette() {
    cmdOverlay.classList.add('active');
    cmdInput.value = '';
    cmdItems = [];
    cmdSelectedIndex = -1;
    renderCmdRecents();
    cmdInput.focus();
}

function closeCmdPalette() {
    cmdOverlay.classList.remove('active');
}

function getCmdRecents() {
    try { return JSON.parse(localStorage.getItem('onelife-cmd-recents') || '[]'); }
    catch { return []; }
}

function pushCmdRecent(item) {
    const recents = getCmdRecents().filter(r => !(r.type === item.type && r.id === item.id));
    recents.unshift({ type: item.type, id: item.id, title: item.title, section: item.section, subtitle: item.subtitle });
    localStorage.setItem('onelife-cmd-recents', JSON.stringify(recents.slice(0, 8)));
}

function renderCmdRecents() {
    const recents = getCmdRecents();
    if (recents.length === 0) {
        cmdResults.innerHTML = '<div class="cmd-palette-empty">Start typing to search across your data...</div>';
        return;
    }
    cmdItems = recents;
    cmdSelectedIndex = 0;
    cmdResults.innerHTML = `
        <div class="cmd-palette-section-label">Recent</div>
        ${recents.map((item, i) => `
            <div class="cmd-palette-item ${i === 0 ? 'selected' : ''}" data-index="${i}" onclick="navigateCmdResult(${i})">
                <div class="cmd-palette-item-icon">${getCmdIcon(item.type)}</div>
                <div>
                    <div class="cmd-palette-item-title">${escapeHtml(item.title)}</div>
                    <div class="cmd-palette-item-subtitle">${escapeHtml(item.subtitle || '')} — ${item.section}</div>
                </div>
            </div>
        `).join('')}
    `;
}

cmdInput.addEventListener('input', () => {
    clearTimeout(cmdTimeout);
    const q = cmdInput.value.trim();
    if (q.length < 1) {
        renderCmdRecents();
        return;
    }
    cmdTimeout = setTimeout(() => searchCmdPalette(q), 200);
});

async function searchCmdPalette(q) {
    try {
        const res = await api(`/search?q=${encodeURIComponent(q)}`);
        cmdItems = res.results;
        renderCmdResults();
    } catch (e) {
        cmdResults.innerHTML = '<div class="cmd-palette-empty">Search failed</div>';
    }
}

function renderCmdResults() {
    if (cmdItems.length === 0) {
        cmdResults.innerHTML = '<div class="cmd-palette-empty">No results found</div>';
        cmdSelectedIndex = -1;
        return;
    }
    cmdSelectedIndex = 0;
    cmdResults.innerHTML = cmdItems.map((item, i) => `
        <div class="cmd-palette-item ${i === 0 ? 'selected' : ''}" data-index="${i}" onclick="navigateCmdResult(${i})">
            <div class="cmd-palette-item-icon">
                ${getCmdIcon(item.type)}
            </div>
            <div>
                <div class="cmd-palette-item-title">${escapeHtml(item.title)}</div>
                <div class="cmd-palette-item-subtitle">${escapeHtml(item.subtitle)} — ${item.section}</div>
            </div>
        </div>
    `).join('');
}

function getCmdIcon(type) {
    const icons = {
        task: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
        contact: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
        journal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        learning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
        event: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>',
        goal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
        asset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>'
    };
    return icons[type] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
}

function navigateCmdResult(index) {
    const item = cmdItems[index];
    if (!item) return;
    pushCmdRecent(item);
    closeCmdPalette();
    navigateTo(item.section);
    setTimeout(() => {
        showToast(`Opened: ${item.title}`, 'info', { duration: 2200 });
    }, 250);
}

// Keyboard navigation for command palette
cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        cmdSelectedIndex = Math.min(cmdSelectedIndex + 1, cmdItems.length - 1);
        updateCmdSelection();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cmdSelectedIndex = Math.max(cmdSelectedIndex - 1, 0);
        updateCmdSelection();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (cmdSelectedIndex >= 0 && cmdSelectedIndex < cmdItems.length) {
            navigateCmdResult(cmdSelectedIndex);
        }
    } else if (e.key === 'Escape') {
        closeCmdPalette();
    }
});

cmdOverlay.addEventListener('click', (e) => {
    if (e.target === cmdOverlay) closeCmdPalette();
});

function updateCmdSelection() {
    document.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
        el.classList.toggle('selected', i === cmdSelectedIndex);
        if (i === cmdSelectedIndex) el.scrollIntoView({ block: 'nearest' });
    });
}

// Global Ctrl+K / Cmd+K
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openCmdPalette();
    }
});

// ==================== NAVIGATION ====================

const sections = {
    dashboard: { title: 'Dashboard', render: renderDashboard },
    tasks: { title: 'Tasks', render: renderTasks },
    health: { title: 'Health & Wellness', render: renderHealth },
    finance: { title: 'Finance & Budget', render: renderFinance },
    learning: { title: 'Learning & Growth', render: renderLearning },
    calendar: { title: 'Calendar', render: renderCalendar },
    contacts: { title: 'Contacts', render: renderContacts },
    documents: { title: 'Drive', render: renderDrive },
    journal: { title: 'Journal', render: renderJournal },
    goals: { title: 'Goals', render: renderGoals },
    settings: { title: 'Settings', render: renderSettings },
    data: { title: 'Backup & Restore', render: renderDataManagement }
};

let currentSection = 'dashboard';
const contentArea = document.getElementById('contentArea');
const pageTitle = document.getElementById('pageTitle');
const sidebar = document.getElementById('sidebar');
const mobileToggle = document.getElementById('mobileToggle');

function navigateTo(section) {
    if (!sections[section]) return;
    
    currentSection = section;
    pageTitle.textContent = sections[section].title;
    const breadcrumb = document.getElementById('pageBreadcrumb');
    if (breadcrumb) breadcrumb.textContent = sections[section].title;
    
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.section === section);
    });
    
    document.querySelectorAll('.nav-link').forEach(l => l.removeAttribute('aria-current'));
    const activeLink = document.querySelector(`.nav-link[data-section="${section}"]`);
    if (activeLink) activeLink.setAttribute('aria-current', 'page');
    
    sidebar.classList.remove('active');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop) backdrop.classList.remove('active');
    
    const content = document.getElementById('contentArea');
    content.style.opacity = '0';
    setTimeout(() => {
        content.style.opacity = '1';
        sections[section].render();
        content.style.transition = 'opacity .15s ease';
    }, 80);
    
    window.scrollTo(0, 0);
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = link.dataset.section;
    });
});

mobileToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop) backdrop.classList.toggle('active');
});

const sidebarBackdrop = document.getElementById('sidebarBackdrop');
if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
        sidebar.classList.remove('active');
        sidebarBackdrop.classList.remove('active');
    });
}

// Set current date in header
document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// ==================== DASHBOARD ====================

async function renderDashboard() {
    contentArea.innerHTML = `<div class="card-grid"><div class="card" style="display:flex;align-items:center;gap:14px"><div class="skeleton" style="width:40px;height:40px;border-radius:var(--r);flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="width:80px;height:12px;margin-bottom:6px"></div><div class="skeleton" style="width:50px;height:20px;margin-bottom:4px"></div><div class="skeleton" style="width:60px;height:12px"></div></div></div><div class="card" style="display:flex;align-items:center;gap:14px"><div class="skeleton" style="width:40px;height:40px;border-radius:var(--r);flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="width:50px;height:12px;margin-bottom:6px"></div><div class="skeleton" style="width:90px;height:20px;margin-bottom:4px"></div><div class="skeleton" style="width:70px;height:12px"></div></div></div><div class="card" style="display:flex;align-items:center;gap:14px"><div class="skeleton" style="width:40px;height:40px;border-radius:var(--r);flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="width:90px;height:12px;margin-bottom:6px"></div><div class="skeleton" style="width:90px;height:20px;margin-bottom:4px"></div><div class="skeleton" style="width:80px;height:12px"></div></div></div><div class="card" style="display:flex;align-items:center;gap:14px"><div class="skeleton" style="width:40px;height:40px;border-radius:var(--r);flex-shrink:0"></div><div style="flex:1"><div class="skeleton" style="width:70px;height:12px;margin-bottom:6px"></div><div class="skeleton" style="width:100px;height:20px;margin-bottom:4px"></div><div class="skeleton" style="width:70px;height:12px"></div></div></div></div><div class="grid-3" style="margin-bottom:0"><div class="card"><div class="skeleton" style="width:100px;height:18px;margin-bottom:16px"></div><div class="skeleton" style="width:160px;height:160px;margin:0 auto;border-radius:50%"></div></div><div class="card"><div class="skeleton" style="width:140px;height:18px;margin-bottom:16px"></div><div style="height:180px;display:flex;align-items:flex-end;gap:4px"><div class="skeleton" style="flex:1;height:100px"></div><div class="skeleton" style="flex:1;height:70px"></div><div class="skeleton" style="flex:1;height:130px"></div><div class="skeleton" style="flex:1;height:50px"></div><div class="skeleton" style="flex:1;height:120px"></div><div class="skeleton" style="flex:1;height:80px"></div></div></div><div class="card"><div class="skeleton" style="width:140px;height:18px;margin-bottom:16px"></div><div class="skeleton" style="width:100%;height:14px;margin-bottom:8px"></div><div class="skeleton" style="width:100%;height:14px;margin-bottom:8px"></div><div class="skeleton" style="width:100%;height:14px"></div></div></div>`;
    
    try {
        const [stats, activity, nwHistory, cfHistory, sparkData] = await Promise.all([
            api('/dashboard/stats'),
            api('/dashboard/activity'),
            api('/networth/history').catch(() => ({ history: [] })),
            api('/dashboard/cashflow-history').catch(() => ({ history: [] })),
            api('/dashboard/sparkline-data').catch(() => ({ days: [] }))
        ]);
        
        // Build donut chart for asset allocation
        const typeColors = {
            cash: '#34A853', savings: '#34A853', stock: '#4285F4', crypto: '#A142F4',
            real_estate: '#FBBC05', vehicle: '#EA4335', gold: '#FBBC05',
            certificate: '#FA7B17', bond: '#4285F4', other: '#9AA0A6'
        };
        const assetTypes = stats.finance.asset_breakdown || [];
        const totalNW = stats.finance.net_worth || 0;
        
        // Build bar chart data for 6-month income/expense
        const barMonths = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            barMonths.push(d.toLocaleDateString('en-US', { month: 'short' }));
        }
        
        contentArea.innerHTML = `
            <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 500; margin-bottom: 2px;" id="dashGreeting"></h2>
                    <p style="color: var(--c-text2); font-size: 0.875rem;">Here's an overview of your life today.</p>
                </div>
                <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: var(--c-surface); border: 1px solid var(--c-border2); border-radius: var(--r-full); font-size: 0.8125rem; color: var(--c-text2); box-shadow: var(--sh-xs);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span id="dashDate"></span>
                </div>
            </div>
            <div class="card-grid">
                <div class="card card-stat">
                    <div class="card-icon" style="background: #FBBC05">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                    </div>
                    <div class="card-stat-body">
                        <div class="card-title">Pending Tasks</div>
                        <div class="card-value">${stats.tasks.pending}</div>
                        <div class="card-subtitle">${stats.tasks.urgent} urgent</div>
                    </div>
                </div>

                <div class="card card-stat card-stat-finance">
                    <div class="card-stat-top">
                        <div class="card-icon card-icon-sm" style="background: #34A853">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>
                        </div>
                        <div class="card-title">Cash</div>
                    </div>
                    <div class="card-value">${formatNumber(stats.finance.cash)}<span class="card-value-unit">₫</span></div>
                    ${(() => {
                        const vals = sparkData.days.map(d => d.cash);
                        const delta = buildDelta(vals[vals.length - 1], vals[0]);
                        return buildSparkline(vals, '#34A853') + `<div class="card-subtitle card-delta-row"><span class="delta-context">vs last month</span>${delta.html}</div>`;
                    })()}
                </div>

                <div class="card card-stat card-stat-finance">
                    <div class="card-stat-top">
                        <div class="card-icon card-icon-sm" style="background: #FBBC05">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                        </div>
                        <div class="card-title">Investments</div>
                    </div>
                    <div class="card-value">${formatNumber(stats.finance.investments)}<span class="card-value-unit">₫</span></div>
                    ${(() => {
                        const vals = sparkData.days.map(d => d.investments);
                        const delta = buildDelta(vals[vals.length - 1], vals[0]);
                        const gainHtml = `<span class="stat-trend ${stats.finance.unrealized_gain >= 0 ? 'up' : 'down'}">${stats.finance.unrealized_gain >= 0 ? '+' : ''}${formatCompact(stats.finance.unrealized_gain)}</span>`;
                        return buildSparkline(vals, '#FBBC05') + `<div class="card-subtitle card-delta-row">${gainHtml}<span class="delta-context">unrealized</span>${delta.html}</div>`;
                    })()}
                </div>

                <div class="card card-stat card-stat-finance">
                    <div class="card-stat-top">
                        <div class="card-icon card-icon-sm" style="background: #A142F4">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                        </div>
                        <div class="card-title">Net Worth</div>
                    </div>
                    <div class="card-value">${formatNumber(totalNW)}<span class="card-value-unit">₫</span></div>
                    ${(() => {
                        const vals = sparkData.days.map(d => d.net_worth);
                        const delta = buildDelta(vals[vals.length - 1], vals[0]);
                        return buildSparkline(vals, '#A142F4') + `<div class="card-subtitle card-delta-row"><span class="delta-context">vs last week</span>${delta.html}</div>`;
                    })()}
                </div>
            </div>

            <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); margin-bottom: 16px;">
                <div class="quick-action" onclick="navigateTo('tasks'); setTimeout(() => showTaskForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: var(--g-blue);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Add Task</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Quick capture</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('health'); setTimeout(() => showHealthForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #34A853;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Log Health</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Track metrics</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('finance'); setTimeout(() => showTransactionForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #FBBC05;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Add Transaction</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Log money in/out</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('finance'); setTimeout(() => showAssetForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #FA7B17;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Add Asset</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Track holdings</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('calendar'); setTimeout(() => showEventForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #4285F4;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Add Event</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Schedule it</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('journal'); setTimeout(() => showJournalForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #EA4335;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Write Journal</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Reflect on today</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('contacts'); setTimeout(() => showContactForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #34A853;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Add Contact</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Stay in touch</div>
                    </div>
                </div>
                <div class="quick-action" onclick="navigateTo('goals'); setTimeout(() => showGoalForm(), 200);" role="button" tabindex="0">
                    <div class="card-icon" style="background: #A142F4;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                    </div>
                    <div>
                        <div style="font-weight: 500; font-size: .875rem;">Set Goal</div>
                        <div style="font-size: .75rem; color: var(--c-text2);">Track progress</div>
                    </div>
                </div>
            </div>

            <!-- Charts Section -->
            <div class="grid-3" style="margin-bottom: 0;">
                <div class="card">
                    <h3 class="section-title" style="margin-bottom: 12px;">Portfolio</h3>
                    ${totalNW > 0 ? `
                        <div class="donut-chart">
                            <svg viewBox="0 0 36 36">
                                ${(() => {
                                    const active = assetTypes.filter(a => a.value > 0);
                                    const radius = 15.9155;
                                    const circumference = 2 * Math.PI * radius;
                                    let offset = 0;
                                    return active.map(a => {
                                        const pct = (a.value / totalNW) * 100;
                                        const color = typeColors[a.type] || '#94a3b8';
                                        const dash = (pct / 100) * circumference;
                                        const gap = circumference - dash;
                                        const seg = `<circle cx="18" cy="18" r="${radius}" fill="none" stroke="${color}" stroke-width="3.5" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" stroke-linecap="round"/>`;
                                        offset += dash;
                                        return seg;
                                    }).join('');
                                })()}
                            </svg>
                            <div class="donut-center">
                                <span>${fmtVnd(totalNW)}</span>
                                <span>Total Value</span>
                            </div>
                        </div>
                        <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 6px;">
                            ${assetTypes.filter(a => a.value > 0).map(a => {
                                const pct = ((a.value / totalNW) * 100).toFixed(1);
                                const color = typeColors[a.type] || '#94a3b8';
                                const label = a.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                                return `
                                    <div style="display: flex; align-items: center; gap: 10px; font-size: 0.8125rem;">
                                        <span style="width: 10px; height: 10px; border-radius: 3px; background: ${color}; flex-shrink: 0;"></span>
                                        <span style="flex: 1; color: var(--c-text2);">${label}</span>
                                        <span style="font-weight: 600; color: var(--c-text);">${fmtVnd(a.value)}</span>
                                        <span style="color: var(--c-text3); min-width: 42px; text-align: right;">${pct}%</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    ` : '<div class="empty-state" style="padding: 24px;">Add assets to see your portfolio</div>'}
                </div>
                
                <div class="card">
                    <h3 class="section-title" style="margin-bottom: 20px;">Net Worth Trend</h3>
                    ${nwHistory.history && nwHistory.history.length > 1 ? (() => {
                        const hist = nwHistory.history;
                        const W = 440, H = 180, padL = 48, padR = 8, padT = 12, padB = 28;
                        const cw = W - padL - padR, ch = H - padT - padB;
                        const maxVal = Math.max(...hist.map(h => h.net_worth), 1);
                        const sx = (i) => padL + (i / (hist.length - 1)) * cw;
                        const sy = (v) => padT + ch - (v / maxVal) * ch;
                        
                        const totalPtsArr = hist.map((h, i) => ({ x: sx(i), y: sy(h.net_worth) }));
                        const cashPtsArr = hist.map((h, i) => ({ x: sx(i), y: sy(h.cash || 0) }));
                        const invPtsArr = hist.map((h, i) => ({ x: sx(i), y: sy((h.cash || 0) + (h.investments || 0)) }));
                        
                        const totalBezier = getBezierPath(totalPtsArr);
                        const cashBezier = getBezierPath(cashPtsArr);
                        const invBezier = getBezierPath(invPtsArr);
                        
                        const areaInv = invBezier ? `${invBezier} L ${sx(hist.length - 1)} ${padT + ch} L ${sx(0)} ${padT + ch} Z` : '';
                        const areaCash = cashBezier ? `${cashBezier} L ${sx(hist.length - 1)} ${padT + ch} L ${sx(0)} ${padT + ch} Z` : '';
                        
                        const yTicks = 4;
                        const tickVals = Array.from({length: yTicks + 1}, (_, i) => Math.round(maxVal * i / yTicks));
                        
                        return `
                            <div style="position: relative;">
                                <svg width="100%" viewBox="0 0 ${W} ${H}" style="display: block;">
                                    <defs>
                                        <linearGradient id="gradInv" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#4285F4" stop-opacity="0.25"/>
                                            <stop offset="100%" stop-color="#4285F4" stop-opacity="0.03"/>
                                        </linearGradient>
                                        <linearGradient id="gradCash" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stop-color="#34A853" stop-opacity="0.3"/>
                                            <stop offset="100%" stop-color="#34A853" stop-opacity="0.03"/>
                                        </linearGradient>
                                    </defs>
                                    ${tickVals.map(v => `
                                        <line x1="${padL}" y1="${sy(v)}" x2="${W - padR}" y2="${sy(v)}" stroke="var(--c-border)" stroke-width="0.5" stroke-dasharray="3,3"/>
                                        <text x="${padL - 6}" y="${sy(v) + 3.5}" text-anchor="end" fill="var(--c-text3)" font-size="8">${formatCurrencyShort(v)}</text>
                                    `).join('')}
                                    <path d="${areaInv}" fill="url(#gradInv)"/>
                                    <path d="${areaCash}" fill="url(#gradCash)"/>
                                    <path d="${invBezier}" fill="none" stroke="#4285F4" stroke-width="1.5" stroke-linejoin="round" opacity="0.7"/>
                                    <path d="${cashBezier}" fill="none" stroke="#34A853" stroke-width="1.5" stroke-linejoin="round" opacity="0.8"/>
                                    <path d="${totalBezier}" fill="none" stroke="var(--c-text)" stroke-width="1.5" stroke-linejoin="round" opacity="0.4"/>
                                    ${hist.map((h, i) => `
                                        <circle cx="${sx(i)}" cy="${sy((h.investments || 0) + (h.cash || 0))}" r="2.5" fill="#4285F4" stroke="var(--c-surface)" stroke-width="1.5"/>
                                        <circle cx="${sx(i)}" cy="${sy(h.cash || 0)}" r="2.5" fill="#34A853" stroke="var(--c-surface)" stroke-width="1.5"/>
                                    `).join('')}
                                    ${hist.map((h, i) => {
                                        const m = parseInt(h.month.split('-')[1]);
                                        const names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                        return `<text x="${sx(i)}" y="${H - 6}" text-anchor="middle" fill="var(--c-text3)" font-size="8">${names[m]}</text>`;
                                    }).join('')}
                                </svg>
                            </div>
                            <div style="display: flex; gap: 16px; margin-top: 12px; justify-content: center; font-size: 0.75rem; color: var(--c-text2);">
                                <span style="display: flex; align-items: center; gap: 5px;">
                                    <span style="width: 8px; height: 3px; border-radius: 2px; background: #34A853;"></span>
                                    Cash
                                </span>
                                <span style="display: flex; align-items: center; gap: 5px;">
                                    <span style="width: 8px; height: 3px; border-radius: 2px; background: #4285F4;"></span>
                                    Investments
                                </span>
                                <span style="display: flex; align-items: center; gap: 5px;">
                                    <span style="width: 8px; height: 3px; border-radius: 2px; background: var(--c-text); opacity: 0.4;"></span>
                                    Total
                                </span>
                            </div>
                        `;
                    })() : '<div class="empty-state" style="padding: 24px;">Not enough data for trend</div>'}
                </div>
                
                <div class="card" style="display: flex; flex-direction: column;">
                    <h3 class="section-title" style="margin-bottom: 12px;">Monthly Cashflow</h3>
                    <div style="display: flex; gap: 16px; align-items: flex-start;">
                        <div style="flex: 1; text-align: center;">
                            <div style="font-size: 0.6875rem; color: var(--c-text3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Income</div>
                            <div style="font-size: 1.125rem; font-weight: 600; color: #34A853;">${formatNumber(stats.finance.income)}<span class="card-value-unit">₫</span></div>
                        </div>
                        <div style="width: 1px; height: 36px; background: var(--c-border); align-self: center;"></div>
                        <div style="flex: 1; text-align: center;">
                            <div style="font-size: 0.6875rem; color: var(--c-text3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Expenses</div>
                            <div style="font-size: 1.125rem; font-weight: 600; color: #EA4335;">${formatNumber(stats.finance.expense)}<span class="card-value-unit">₫</span></div>
                        </div>
                        <div style="width: 1px; height: 36px; background: var(--c-border); align-self: center;"></div>
                        <div style="flex: 1; text-align: center;">
                            <div style="font-size: 0.6875rem; color: var(--c-text3); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Balance</div>
                            <div style="font-size: 1.125rem; font-weight: 600; color: ${stats.finance.balance >= 0 ? '#34A853' : '#EA4335'};">${formatNumber(stats.finance.balance)}<span class="card-value-unit">₫</span></div>
                        </div>
                    </div>
                    ${stats.finance.income > 0 ? `
                        <div style="margin-top: 14px;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--c-text3); margin-bottom: 6px;">
                                <span>Spending ratio</span>
                                <span>${((stats.finance.expense / stats.finance.income) * 100).toFixed(0)}%</span>
                            </div>
                            <div style="height: 6px; background: var(--c-surface2); border-radius: 3px; overflow: hidden;">
                                <div style="height: 100%; width: ${Math.min((stats.finance.expense / stats.finance.income) * 100, 100)}%; background: ${stats.finance.expense / stats.finance.income > 1 ? '#EA4335' : stats.finance.expense / stats.finance.income > 0.8 ? '#FBBC05' : '#34A853'}; border-radius: 3px; transition: width 0.5s;"></div>
                            </div>
                        </div>
                    ` : stats.finance.expense > 0 ? `
                        <div style="margin-top: 14px; padding: 10px 12px; background: var(--c-danger-bg); border-radius: var(--r); display: flex; align-items: center; gap: 8px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EA4335" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                            <span style="font-size: 0.75rem; color: var(--c-text2);">Spending exceeds income this month</span>
                        </div>
                    ` : `
                        <div style="margin-top: 14px; text-align: center; padding: 12px 0; border-top: 1px solid var(--c-border);">
                            <span style="font-size: 0.8125rem; color: var(--c-text3);">No transactions this month</span>
                        </div>
                    `}
                    ${cfHistory.history && cfHistory.history.length > 0 ? (() => {
                        const hist = cfHistory.history;
                        const names = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        const W = 220, H = 110, padB = 20, padT = 6;
                        const ch = H - padT - padB;
                        const maxVal = Math.max(...hist.map(h => Math.max(h.income, h.expense)), 1);
                        const groupW = W / hist.length;
                        const barW = Math.min(groupW * 0.28, 18);
                        return `
                            <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--c-border);">
                                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                                    <span style="font-size: 0.75rem; color: var(--c-text2); font-weight: 500;">Last 6 months</span>
                                    <div style="display: flex; gap: 12px; font-size: 0.6875rem; color: var(--c-text3);">
                                        <span style="display: flex; align-items: center; gap: 4px;">
                                            <span style="width: 8px; height: 8px; border-radius: 2px; background: #34A853;"></span>Income
                                        </span>
                                        <span style="display: flex; align-items: center; gap: 4px;">
                                            <span style="width: 8px; height: 8px; border-radius: 2px; background: #EA4335;"></span>Expense
                                        </span>
                                    </div>
                                </div>
                                <svg viewBox="0 0 ${W} ${H}" style="display: block; width: 100%; height: 110px;">
                                    ${hist.map((h, i) => {
                                        const cx = groupW * i + groupW / 2;
                                        const incH = maxVal > 0 ? (h.income / maxVal) * ch : 0;
                                        const expH = maxVal > 0 ? (h.expense / maxVal) * ch : 0;
                                        return `
                                            <rect x="${cx - barW - 1}" y="${padT + ch - incH}" width="${barW}" height="${incH}" fill="#34A853" rx="2" opacity="${h.income > 0 ? 1 : 0.25}"/>
                                            <rect x="${cx + 1}" y="${padT + ch - expH}" width="${barW}" height="${expH}" fill="#EA4335" rx="2" opacity="${h.expense > 0 ? 1 : 0.25}"/>
                                            <text x="${cx}" y="${H - 6}" text-anchor="middle" fill="var(--c-text3)" font-size="9">${names[h.month]}</text>
                                        `;
                                    }).join('')}
                                </svg>
                            </div>
                        `;
                    })() : ''}
                </div>
            </div>

            <div class="grid-2" style="margin-top: 20px;">
                <div>
                    <h3 class="section-title" style="margin-bottom: 14px;">Upcoming Events</h3>
                    ${stats.events.length > 0 ? `
                        <div>
                            ${stats.events.map(e => `
                                <div class="list-item list-item-actionable" onclick="navigateTo('calendar')">
                                    <div class="list-item-info">
                                        <div class="list-item-title">${escapeHtml(e.title)}</div>
                                        <div class="list-item-meta">${formatDateTime(e.start_time)}</div>
                                    </div>
                                    <div class="list-item-actions">
                                        <span class="badge badge-secondary badge-dot">${e.category || 'general'}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : `<div class="empty-state-compact" style="text-align:center">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        <p style="color:var(--c-text2);font-size:.875rem;margin:0 0 10px">No upcoming events</p>
                        <button class="btn btn-sm btn-primary" onclick="showEventForm()">Add Event</button>
                    </div>`}
                </div>
                
                <div class="activity-feed">
                    <h3 class="section-title" style="margin-bottom: 16px;">Recent Activity</h3>
                    ${activity.length > 0 ? activity.map(a => `
                        <div class="quick-action">
                            <div class="activity-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    ${a.icon === 'check' ? '<path d="M20 6L9 17l-5-5"/>' :
                                      a.icon === 'dollar' ? '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>' :
                                      '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>'}
                                </svg>
                            </div>
                            <div class="activity-content" style="flex: 1; min-width: 0;">
                                <div class="activity-text">${escapeHtml(a.text)}</div>
                                <div class="activity-time">${formatRelativeTime(a.date)}</div>
                            </div>
                        </div>
                    `).join('') : '<div class="empty-state-compact" style="text-align:center;color:var(--c-text3);font-size:.8125rem;padding:24px 16px">No recent activity yet</div>'}
                </div>
            </div>
            
            ${stats.recent_learning.length > 0 ? `
                <div style="margin-top: 32px;">
                    <h3 class="section-title" style="margin-bottom: 16px;">Recently Added Learning</h3>
                    <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
                        ${stats.recent_learning.map(item => `
                            <div class="card">
                                <div class="list-item-title">${escapeHtml(item.title)}</div>
                                <div class="list-item-meta">${item.item_type} &bull; ${item.status}</div>
                                ${item.progress > 0 ? `
                                    <div class="progress-bar" style="margin-top: 12px;">
                                        <div class="progress-fill" style="width: ${item.progress}%"></div>
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <div class="grid-3 widget-grid" id="dashboardWidgets" style="margin-top: 24px; gap: 16px;">
                <div class="card widget" data-widget-id="heatmap" draggable="true">
                    <div class="widget-grip" title="Drag to reorder">⋮⋮</div>
                    <h3 class="section-title" style="margin-bottom: 12px; font-size: 1rem;">Activity</h3>
                    <div class="card-subtitle" style="margin-bottom: 12px; font-size: 0.75rem;">Last 16 weeks</div>
                    <div id="heatmapContainer"><div class="skeleton" style="height: 80px"></div></div>
                </div>
                <div class="card widget" data-widget-id="steps-heatmap" draggable="true">
                    <div class="widget-grip" title="Drag to reorder">⋮⋮</div>
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                        <h3 class="section-title" style="font-size: 1rem;">Steps</h3>
                        <span id="stepsHeatmapTotal" style="font-size:.75rem;color:var(--c-text3);"></span>
                    </div>
                    <div class="card-subtitle" style="margin-bottom: 12px; font-size: 0.75rem;">Last 52 weeks &middot; goal 10,000/day</div>
                    <div id="stepsHeatmapContainer"><div class="skeleton" style="height: 100px"></div></div>
                </div>
                <div class="card widget" data-widget-id="habits" draggable="true">
                    <div class="widget-grip" title="Drag to reorder">⋮⋮</div>
                    <h3 class="section-title" style="margin-bottom: 12px; font-size: 1rem;">Habits</h3>
                    <div id="habitStreaksContainer"><div class="skeleton" style="height: 80px"></div></div>
                </div>
                <div class="card widget" data-widget-id="goals" draggable="true">
                    <div class="widget-grip" title="Drag to reorder">⋮⋮</div>
                    <h3 class="section-title" style="margin-bottom: 12px; font-size: 1rem;">Goals</h3>
                    <div id="goalsProgressContainer"><div class="skeleton" style="height: 80px"></div></div>
                </div>
            </div>
        `;

        // Heatmap
        try {
            const hm = await api('/dashboard/activity-heatmap');
            renderHeatmap(hm.cells || []);
        } catch { document.getElementById('heatmapContainer').innerHTML = '<div class="empty-state-compact">No data</div>'; }

        // Steps heatmap (52 weeks)
        try {
            const shm = await api('/health/steps-heatmap?weeks=52');
            renderHeatmap(shm.cells || [], 'stepsHeatmapContainer', {
                steps: true,
                unit: 'steps',
                empty: 'No steps yet',
                legend: true,
                legendLabel: 'Less',
                legendLabelMore: 'More'
            });
            const totalEl = document.getElementById('stepsHeatmapTotal');
            const total = (shm.cells || []).reduce((s, c) => s + (c.count || 0), 0);
            if (totalEl) totalEl.textContent = `${(total / 1_000_000).toFixed(2)}M steps`;
        } catch { document.getElementById('stepsHeatmapContainer').innerHTML = '<div class="empty-state-compact">No data</div>'; }

        // Habits
        try {
            const tasks = await api('/tasks?is_habit=true');
            const habits = (tasks || []).filter(t => t.is_habit);
            if (habits.length === 0) {
                document.getElementById('habitStreaksContainer').innerHTML = '<div class="empty-state-compact" style="text-align:center;color:var(--c-text3);font-size:.8125rem;padding:18px 0">No habits yet</div>';
            } else {
                document.getElementById('habitStreaksContainer').innerHTML = habits.slice(0, 4).map(h => `
                    <div class="habit-row">
                        <div class="habit-info">
                            <div class="habit-name">${escapeHtml(h.title)}</div>
                            <div class="habit-meta">${h.habit_frequency || 'daily'} &middot; ${h.status || 'pending'}</div>
                        </div>
                        <div style="display:flex;align-items:center;gap:6px">
                            ${h.streak > 0 ? `<span class="streak-badge-premium">🔥 ${h.streak}d</span>` : ''}
                            <div class="habit-streak">${h.status === 'completed' ? '✓ done' : '○ open'}</div>
                        </div>
                    </div>
                `).join('');
            }
        } catch { document.getElementById('habitStreaksContainer').innerHTML = '<div class="empty-state-compact">No data</div>'; }

        // Goals
        try {
            const goals = await api('/goals');
            if (!goals || goals.length === 0) {
                document.getElementById('goalsProgressContainer').innerHTML = '<div class="empty-state-compact" style="text-align:center;color:var(--c-text3);font-size:.8125rem;padding:18px 0">No goals yet</div>';
            } else {
                document.getElementById('goalsProgressContainer').innerHTML = goals.slice(0, 4).map(g => `
                    <div class="goal-row">
                        <div class="goal-title">${escapeHtml(g.title)}</div>
                        <div class="goal-bar"><div class="goal-fill" style="width:${g.progress || 0}%"></div></div>
                        <div class="goal-pct">${g.progress || 0}% complete</div>
                    </div>
                `).join('');
            }
        } catch { document.getElementById('goalsProgressContainer').innerHTML = '<div class="empty-state-compact">No data</div>'; }
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error loading dashboard: ${error.message}</div>`;
    }

    const dashGreet = document.getElementById('dashGreeting');
    if (dashGreet) {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        dashGreet.textContent = greeting + ' 👋';
    }
    const dashDate = document.getElementById('dashDate');
    if (dashDate) {
        const now = new Date();
        const opts = { weekday: 'long', month: 'long', day: 'numeric' };
        const startOfYear = new Date(now.getFullYear(), 0, 0);
        const dayOfYear = Math.floor((now - startOfYear) / 86400000);
        dashDate.textContent = now.toLocaleDateString('en-US', opts) + ` · Day ${dayOfYear}`;
    }
}

// ==================== TASKS ====================

let tasksData = [];
let taskSearchQuery = '';

function filterTasksLive(q) {
    taskSearchQuery = q.toLowerCase();
    const rows = document.querySelectorAll('.table-container tbody tr');
    rows.forEach(row => {
        const title = row.querySelector('strong')?.textContent?.toLowerCase() || '';
        const desc = row.querySelector('td:nth-child(2) div')?.textContent?.toLowerCase() || '';
        const matches = title.includes(taskSearchQuery) || desc.includes(taskSearchQuery);
        row.style.display = matches ? '' : 'none';
    });
}

async function renderTasks() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:140px;height:26px"></h2></div><div class="skeleton" style="width:100px;height:36px;border-radius:var(--r)"></div></div><div class="filters"><div class="skeleton" style="width:180px;height:38px;border-radius:var(--r)"></div></div><div class="table-container"><table><thead><tr><th style="width:40px"><div class="skeleton" style="width:16px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:70px;height:16px"></div></th><th><div class="skeleton" style="width:60px;height:16px"></div></th><th><div class="skeleton" style="width:70px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:60px;height:16px"></div></th></tr></thead><tbody><tr><td><div class="skeleton" style="width:16px;height:16px"></div></td><td><div class="skeleton" style="width:120px;height:16px;margin-bottom:4px"></div><div class="skeleton" style="width:80px;height:12px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:50px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:80px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div style="display:flex;gap:8px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:56px;height:28px;border-radius:var(--r)"></div></div></td></tr><tr><td><div class="skeleton" style="width:16px;height:16px"></div></td><td><div class="skeleton" style="width:140px;height:16px;margin-bottom:4px"></div><div class="skeleton" style="width:60px;height:12px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:50px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:80px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div style="display:flex;gap:8px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:56px;height:28px;border-radius:var(--r)"></div></div></td></tr><tr><td><div class="skeleton" style="width:16px;height:16px"></div></td><td><div class="skeleton" style="width:100px;height:16px;margin-bottom:4px"></div><div class="skeleton" style="width:100px;height:12px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:50px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:80px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div style="display:flex;gap:8px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:56px;height:28px;border-radius:var(--r)"></div></div></td></tr></tbody></table></div>`;
    
    try {
        tasksData = await api('/tasks');
        renderTasksList();
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

let taskFilter = 'all';
let taskSort = 'created';

function setTaskFilter(f) {
    taskFilter = f;
    document.querySelectorAll('#taskFilterPills .pill').forEach(p => p.classList.toggle('active', p.dataset.filter === f));
    renderTasksList();
}

function setTaskSort(s) {
    taskSort = s;
    document.querySelectorAll('#taskSortPills .pill').forEach(p => p.classList.toggle('active', p.dataset.sort === s));
    renderTasksList();
}

let taskViewMode = 'list';

function setTaskView(v) {
    taskViewMode = v;
    renderTasksList();
}

function handleTaskDragStart(e, id) {
    e.dataTransfer.setData('text/plain', id);
    setTimeout(() => {
        const card = document.querySelector(`.kanban-card[data-task-id="${id}"]`);
        if (card) card.classList.add('dragging');
    }, 0);
}

function handleTaskDragEnd(e) {
    document.querySelectorAll('.kanban-card').forEach(c => c.classList.remove('dragging'));
}

function handleTaskDragOver(e) {
    e.preventDefault();
    const col = e.currentTarget.closest('.kanban-column');
    if (col) col.classList.add('drag-over');
}

function handleTaskDragLeave(e) {
    const col = e.currentTarget.closest('.kanban-column');
    if (col) col.classList.remove('drag-over');
}

async function handleTaskDrop(e, targetStatus) {
    e.preventDefault();
    const col = e.currentTarget.closest('.kanban-column');
    if (col) col.classList.remove('drag-over');
    
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!id) return;
    
    const task = tasksData.find(t => t.id === id);
    if (!task || task.status === targetStatus) return;
    
    const prevStatus = task.status;
    task.status = targetStatus;
    renderTasksList();
    
    try {
        await api(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: targetStatus })
        });
        showToast(`Task moved to ${targetStatus.replace('_', ' ')}`, 'success', { duration: 2200 });
    } catch (error) {
        task.status = prevStatus;
        renderTasksList();
        showToast(error.message, 'error');
    }
}

window.setTaskView = setTaskView;
window.handleTaskDragStart = handleTaskDragStart;
window.handleTaskDragEnd = handleTaskDragEnd;
window.handleTaskDragOver = handleTaskDragOver;
window.handleTaskDragLeave = handleTaskDragLeave;
window.handleTaskDrop = handleTaskDrop;

function renderTasksKanban(filtered) {
    const statuses = ['pending', 'in_progress', 'completed'];
    const statusLabels = {
        pending: 'Pending',
        in_progress: 'In Progress',
        completed: 'Completed'
    };
    
    const columnsHtml = statuses.map(status => {
        const colsTasks = filtered.filter(t => t.status === status);
        const cardsHtml = colsTasks.map(t => {
            const isCompleted = t.status === 'completed';
            const priorityClass = t.priority === 'urgent' ? 'danger' : t.priority === 'high' ? 'warning' : 'secondary';
            return `
                <div class="kanban-card" 
                     data-task-id="${t.id}"
                     draggable="true" 
                     ondragstart="handleTaskDragStart(event, ${t.id})"
                     ondragend="handleTaskDragEnd(event)"
                     style="${isCompleted ? 'opacity: 0.7;' : ''}">
                    <div class="kanban-card-title">${escapeHtml(t.title)}</div>
                    ${t.description ? `<div class="kanban-card-desc">${escapeHtml(t.description)}</div>` : ''}
                    <div class="kanban-card-meta">
                        <span class="badge badge-secondary badge-dot">${escapeHtml(t.category)}</span>
                        <span class="badge badge-${priorityClass} badge-dot">${t.priority}</span>
                        ${t.due_date ? `<span style="font-size: 0.6875rem; color: var(--c-text3);">${formatDate(t.due_date)}</span>` : ''}
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px;">
                        <button class="btn btn-sm btn-secondary" onclick="showTaskForm(${t.id})" style="padding: 2px 8px; font-size: 0.75rem;">Edit</button>
                        <button class="btn-icon btn-danger-icon" onclick="deleteTask(${t.id})" title="Delete" aria-label="Delete" style="width: 24px; height: 24px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        return `
            <div class="kanban-column" 
                 ondragover="handleTaskDragOver(event)" 
                 ondragleave="handleTaskDragLeave(event)" 
                 ondrop="handleTaskDrop(event, '${status}')">
                <div class="kanban-column-header">
                    <span class="kanban-column-title">${statusLabels[status]}</span>
                    <span class="kanban-column-count">${colsTasks.length}</span>
                </div>
                <div class="kanban-cards">
                    ${cardsHtml ? cardsHtml : `<div class="rp-empty" style="font-size: 0.75rem; border: 1px dashed var(--c-border); border-radius: var(--r); padding: 20px;">Drop tasks here</div>`}
                </div>
            </div>
        `;
    }).join('');
    
    return `<div class="kanban-view">${columnsHtml}</div>`;
}

function renderTasksList() {
    const filter = taskFilter;
    let filtered = tasksData;
    
    if (filter === 'pending') filtered = tasksData.filter(t => t.status !== 'completed');
    else if (filter === 'completed') filtered = tasksData.filter(t => t.status === 'completed');
    else if (filter === 'habits') filtered = tasksData.filter(t => t.is_habit);

    if (taskSearchQuery) {
        filtered = filtered.filter(t => 
            t.title.toLowerCase().includes(taskSearchQuery) || 
            (t.description && t.description.toLowerCase().includes(taskSearchQuery))
        );
    }

    const sortBy = taskSort;
    filtered.sort((a, b) => {
        if (sortBy === 'priority') {
            const order = {urgent: 0, high: 1, medium: 2, low: 3};
            return (order[a.priority] || 2) - (order[b.priority] || 2);
        }
        if (sortBy === 'due_date') {
            if (!a.due_date) return 1;
            if (!b.due_date) return -1;
            return new Date(a.due_date) - new Date(b.due_date);
        }
        if (sortBy === 'status') {
            const order = {in_progress: 0, pending: 1, completed: 2, cancelled: 3};
            return (order[a.status] || 1) - (order[b.status] || 1);
        }
        return new Date(b.created_at) - new Date(a.created_at);
    });
    
    contentArea.innerHTML = `
        <div class="section-header">
            <div>
                <div class="page-breadcrumb">OneLife &nbsp;/&nbsp; Tasks</div>
                <h2 class="section-title" style="margin-top: 4px;">Your Tasks</h2>
            </div>
            <button class="btn btn-primary" onclick="showTaskForm()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Task
            </button>
        </div>

        <div class="filters">
            <div class="pill-group" id="taskFilterPills">
                <button class="pill active" data-filter="all" onclick="setTaskFilter('all')">All</button>
                <button class="pill" data-filter="pending" onclick="setTaskFilter('pending')">Pending</button>
                <button class="pill" data-filter="completed" onclick="setTaskFilter('completed')">Completed</button>
                <button class="pill" data-filter="habits" onclick="setTaskFilter('habits')">Habits</button>
            </div>
            <div class="pill-group" id="taskSortPills" style="${taskViewMode === 'kanban' ? 'display: none;' : ''}">
                <button class="pill active" data-sort="created" onclick="setTaskSort('created')">Newest</button>
                <button class="pill" data-sort="priority" onclick="setTaskSort('priority')">Priority</button>
                <button class="pill" data-sort="due_date" onclick="setTaskSort('due_date')">Due</button>
                <button class="pill" data-sort="status" onclick="setTaskSort('status')">Status</button>
            </div>
            <div class="view-toggle-pills" id="taskViewPills">
                <button class="pill ${taskViewMode === 'list' ? 'active' : ''}" onclick="setTaskView('list')">List</button>
                <button class="pill ${taskViewMode === 'kanban' ? 'active' : ''}" onclick="setTaskView('kanban')">Board</button>
            </div>
            <div class="section-search-container">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" class="section-search-input" id="taskSearchInput" placeholder="Filter tasks..." oninput="filterTasksLive(this.value)" value="${escapeHtml(taskSearchQuery)}">
            </div>
        </div>

        ${filtered.length > 0 ? (
            taskViewMode === 'kanban' ? renderTasksKanban(filtered) : `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 40px;"></th>
                            <th>Task</th>
                            <th>Category</th>
                            <th>Priority</th>
                            <th>Due Date</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filtered.map(t => `
                            <tr style="${t.status === 'completed' ? 'opacity: 0.6;' : ''}">
                                <td>
                                    <input type="checkbox" ${t.status === 'completed' ? 'checked' : ''}
                                        onchange="toggleTaskStatus(${t.id}, this.checked)"
                                        style="cursor: pointer;">
                                </td>
                                <td>
                                    <strong>${escapeHtml(t.title)}</strong>
                                    ${t.description ? `<div style="font-size: 0.8125rem; color: var(--c-text2); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.description || '').substring(0, 60)}${(t.description || '').length > 60 ? '...' : ''}</div>` : ''}
                                    ${t.is_habit ? `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span class="badge badge-info badge-dot">Habit</span>${t.streak > 0 ? `<span class="streak-badge-premium" style="padding:1px 6px;font-size:0.6875rem;">🔥 ${t.streak}d</span>` : ''}</div>` : ''}
                                </td>
                                <td><span class="badge badge-secondary badge-dot">${t.category}</span></td>
                                <td><span class="badge badge-${t.priority === 'urgent' ? 'danger' : t.priority === 'high' ? 'warning' : 'secondary'} badge-dot">${t.priority}</span></td>
                                <td>${formatDate(t.due_date)}</td>
                                <td><span class="badge badge-${t.status === 'completed' ? 'success' : t.status === 'in_progress' ? 'info' : 'secondary'} badge-dot">${t.status}</span></td>
                                <td>
                                    <button class="btn btn-sm btn-secondary" onclick="showTaskForm(${t.id})">Edit</button>
                                    <button class="btn-icon btn-danger-icon" onclick="deleteTask(${t.id})" title="Delete" aria-label="Delete">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <button class="fab" onclick="showTaskForm()" title="New Task" aria-label="New Task">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            `
        ) : `<div class="empty-state">
            <div class="empty-state-illustration">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            </div>
            <h3>No tasks yet</h3>
            <p>Get started by adding your first task and stay on top of your day.</p>
            <button class="btn btn-primary" onclick="showTaskForm()">Create Task</button>
        </div>`}
    `;
    
    document.querySelectorAll('#taskFilterPills .pill').forEach(p => p.classList.toggle('active', p.dataset.filter === filter));
    if (taskViewMode !== 'kanban') {
        document.querySelectorAll('#taskSortPills .pill').forEach(p => p.classList.toggle('active', p.dataset.sort === sortBy));
    }
}

async function toggleTaskStatus(id, completed) {
    const task = tasksData.find(t => t.id === id);
    if (!task) return;
    const prevStatus = task.status;
    task.status = completed ? 'completed' : 'pending';
    renderTasksList();
    try {
        await api(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: task.status })
        });
        showToast(completed ? 'Task completed!' : 'Task reopened', 'success', { duration: 2200 });
    } catch (error) {
        task.status = prevStatus;
        renderTasksList();
        showToast(error.message, 'error');
    }
}

function showTaskForm(id = null) {
    const task = id ? tasksData.find(t => t.id === id) : null;
    
    openModal(id ? 'Edit Task' : 'New Task', `
        <form id="taskForm" onsubmit="saveTask(event, ${id || 'null'})" data-validate="true">
            <div class="form-group">
                <label class="form-label">Title <span class="required-mark">*</span></label>
                <input type="text" class="form-control" name="title" value="${escapeHtml(task?.title || '')}" required maxlength="200">
            </div>
            <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-control" name="description" rows="3">${escapeHtml(task?.description || '')}</textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Category</label>
                    <select class="form-control" name="category">
                        <option value="general" ${task?.category === 'general' || !task ? 'selected' : ''}>General</option>
                        <option value="work" ${task?.category === 'work' ? 'selected' : ''}>Work</option>
                        <option value="personal" ${task?.category === 'personal' ? 'selected' : ''}>Personal</option>
                        <option value="errand" ${task?.category === 'errand' ? 'selected' : ''}>Errand</option>
                        <option value="home" ${task?.category === 'home' ? 'selected' : ''}>Home</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Priority</label>
                    <select class="form-control" name="priority">
                        <option value="medium" ${!task || task?.priority === 'medium' ? 'selected' : ''}>Medium</option>
                        <option value="low" ${task?.priority === 'low' ? 'selected' : ''}>Low</option>
                        <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>High</option>
                        <option value="urgent" ${task?.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Due Date</label>
                    <input type="date" class="form-control" name="due_date" value="${task?.due_date || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Status</label>
                    <select class="form-control" name="status">
                        <option value="pending" ${task?.status === 'pending' || !task ? 'selected' : ''}>Pending</option>
                        <option value="in_progress" ${task?.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                        <option value="completed" ${task?.status === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
                    <span class="toggle-switch ${task?.is_habit ? 'active' : ''}" id="habitToggle" role="switch" aria-checked="${task?.is_habit ? 'true' : 'false'}" tabindex="0"></span>
                    <input type="checkbox" name="is_habit" id="habitInput" ${task?.is_habit ? 'checked' : ''} style="display: none;">
                    This is a habit
                </label>
            </div>
            <div class="form-group" id="habitFrequency" style="display: ${task?.is_habit ? 'block' : 'none'};">
                <label class="form-label">Frequency</label>
                <select class="form-control" name="habit_frequency">
                    <option value="daily" ${task?.habit_frequency === 'daily' ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${task?.habit_frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${task?.habit_frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                </select>
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Task</button>
            </div>
        </form>
    `);

    // Toggle habit frequency visibility via toggle switch
    const habitToggle = document.getElementById('habitToggle');
    const habitInput = document.getElementById('habitInput');
    if (habitToggle && habitInput) {
        const setHabit = (on) => {
            habitToggle.classList.toggle('active', on);
            habitToggle.setAttribute('aria-checked', on ? 'true' : 'false');
            habitInput.checked = on;
            document.getElementById('habitFrequency').style.display = on ? 'block' : 'none';
        };
        habitToggle.addEventListener('click', () => setHabit(!habitToggle.classList.contains('active')));
        habitToggle.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setHabit(!habitToggle.classList.contains('active')); }
        });
    }
}

async function saveTask(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        title: form.title.value,
        description: form.description.value,
        category: form.category.value,
        priority: form.priority.value,
        due_date: form.due_date.value || null,
        status: form.status.value,
        is_habit: form.is_habit.checked,
        habit_frequency: form.is_habit.checked ? form.habit_frequency.value : null
    };
    
    try {
        if (id) {
            await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Task updated successfully');
        } else {
            await api('/tasks', { method: 'POST', body: JSON.stringify(data) });
            showToast('Task created successfully');
        }
        closeModal();
        renderTasks();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteTask(id) {
    const item = tasksData.find(t => t.id === id);
    if (!item) return;
    if (!confirm('Are you sure you want to delete this task?')) return;

    const snapshot = { ...item };
    try {
        await api(`/tasks/${id}`, { method: 'DELETE' });
        tasksData = tasksData.filter(t => t.id !== id);
        showToast('Task deleted', 'success', {
            duration: 6000,
            undo: async () => {
                const { id: _drop, ...payload } = snapshot;
                const restored = await api('/tasks', { method: 'POST', body: JSON.stringify(payload) });
                tasksData.unshift(restored);
                renderTasksList();
                showToast('Task restored', 'success');
            }
        });
        renderTasksList();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== HEALTH ====================

let healthEntriesData = [];
let healthRangeDays = parseInt(localStorage.getItem('healthRangeDays') || '30', 10);
const HEALTH_RANGE_OPTIONS = [7, 30, 90, 365, 0];

function setHealthRange(days) {
    healthRangeDays = days;
    localStorage.setItem('healthRangeDays', String(days));
    renderHealth();
}

function renderHealthTable(entries) {
    return entries.length > 0 ? `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Weight</th>
                        <th>Steps</th>
                        <th>Distance</th>
                        <th>Workout</th>
                        <th>Mood</th>
                        <th>Sleep</th>
                        <th>Water</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(e => `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${e.weight || '-'}</td>
                            <td>${e.steps?.toLocaleString() || '-'}</td>
                            <td>${e.distance_km ? e.distance_km.toFixed(2) + ' km' : '-'}</td>
                            <td>${e.workout_minutes ? e.workout_minutes + ' min' : '-'}</td>
                            <td><span class="badge badge-${e.mood === 'amazing' || e.mood === 'good' ? 'success' : e.mood === 'okay' ? 'warning' : 'danger'} badge-dot">${e.mood || '-'}</span></td>
                            <td>${e.sleep_hours ? e.sleep_hours + 'h' : '-'}</td>
                            <td>${e.water_liters ? e.water_liters + 'L' : '-'}</td>
                            <td>
                                <button class="btn btn-sm btn-secondary" onclick="showHealthForm(${e.id})">Edit</button>
                                <button class="btn-icon btn-danger-icon" onclick="deleteHealthEntry(${e.id})" title="Delete" aria-label="Delete">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : `<div class="empty-state">
        <div class="empty-state-illustration">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        </div>
        <h3>No entries yet</h3>
        <p>Track your daily wellness, steps, sleep and more to see trends over time.</p>
        <button class="btn btn-primary" onclick="showHealthForm()">Log Entry</button>
    </div>`;
}

function filterHealthEntries() {
    const from = document.getElementById('healthDateFrom')?.value;
    const to = document.getElementById('healthDateTo')?.value;
    let filtered = [...healthEntriesData];
    if (from) filtered = filtered.filter(e => e.date >= from);
    if (to) filtered = filtered.filter(e => e.date <= to);
    const container = document.getElementById('healthTableContainer');
    if (container) {
        container.innerHTML = renderHealthTable(filtered);
    }
}

async function renderHealth() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:180px;height:26px"></h2></div><div class="skeleton" style="width:110px;height:36px;border-radius:var(--r)"></div></div><div class="card-grid" style="margin-bottom:32px"><div class="card"><div class="skeleton" style="width:90px;height:16px;margin-bottom:8px"></div><div class="skeleton" style="width:70px;height:24px"></div></div><div class="card"><div class="skeleton" style="width:80px;height:16px;margin-bottom:8px"></div><div class="skeleton" style="width:60px;height:24px"></div></div><div class="card"><div class="skeleton" style="width:80px;height:16px;margin-bottom:8px"></div><div class="skeleton" style="width:80px;height:24px"></div></div><div class="card"><div class="skeleton" style="width:110px;height:16px;margin-bottom:8px"></div><div class="skeleton" style="width:70px;height:24px"></div></div></div><div class="table-container"><table><thead><tr><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:60px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:70px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:70px;height:16px"></div></th></tr></thead><tbody><tr><td><div class="skeleton" style="width:80px;height:16px"></div></td><td><div class="skeleton" style="width:50px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:40px;height:16px"></div></td><td><div class="skele`;
    
    try {
        const rangeParam = healthRangeDays > 0 ? `?days=${healthRangeDays}` : '';
        const [entries, stats] = await Promise.all([
            api('/health'),
            api('/health/stats' + rangeParam)
        ]);
        
        healthEntriesData = entries;

        const chartEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);

        let streak = 0;
        if (entries.length > 0) {
            const dateSet = new Set(entries.map(e => e.date));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStr = today.toISOString().split('T')[0];
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            let cursor = null;
            if (dateSet.has(todayStr)) {
                cursor = new Date(today);
            } else if (dateSet.has(yesterdayStr)) {
                cursor = new Date(yesterday);
            }
            while (cursor) {
                const dStr = cursor.toISOString().split('T')[0];
                if (dateSet.has(dStr)) {
                    streak++;
                    cursor.setDate(cursor.getDate() - 1);
                } else {
                    break;
                }
            }
        }
        const streakHtml = streak > 0
            ? `<div class="streak-badge" title="Consecutive days with a logged health entry">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#FBBC05" stroke="#FBBC05" stroke-width="1.5" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>
                <span>${streak} day${streak === 1 ? '' : 's'} streak</span>
            </div>`
            : '';
        
        let trendChart = '';
        if (chartEntries.length > 1) {
            const W = 700, H = 220, padL = 50, padR = 50, padT = 16, padB = 32;
            const cw = W - padL - padR, ch = H - padT - padB;
            
            const weights = chartEntries.map(e => e.weight).filter(w => w != null);
            const stepsArr = chartEntries.map(e => e.steps || 0);
            
            const minW = Math.min(...weights) - 2;
            const maxW = Math.max(...weights) + 2;
            const maxS = Math.max(...stepsArr, 1);
            
            const sx = (i) => padL + (i / (chartEntries.length - 1)) * cw;
            const syW = (v) => padT + ch - ((v - minW) / (maxW - minW)) * ch;
            const syS = (v) => padT + ch - (v / maxS) * ch;
            
            const weightLine = chartEntries.map((e, i) => e.weight != null ? `${sx(i)},${syW(e.weight)}` : null).filter(Boolean).join(' ');
            const areaPts = chartEntries.map((e, i) => e.weight != null ? `${sx(i)},${syW(e.weight)}` : null).filter(Boolean);
            const areaPoly = areaPts.length > 0 ? `${sx(0)},${padT + ch} ${areaPts.join(' ')} ${sx(chartEntries.length - 1)},${padT + ch}` : '';
            
            const barW = Math.max(2, Math.min(12, cw / chartEntries.length * 0.5));
            const yTicks = 4;
            const weightTicks = Array.from({length: yTicks + 1}, (_, i) => Math.round((minW + (maxW - minW) * i / yTicks) * 10) / 10);

            trendChart = `
                <div class="card" style="margin-bottom: 24px;">
                    <h3 class="section-title" style="margin-bottom: 16px;">Health Trends</h3>
                    <div style="position: relative;">
                        <svg width="100%" viewBox="0 0 ${W} ${H}" style="display: block;">
                            <defs>
                                <linearGradient id="gradWeight" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stop-color="#4285F4" stop-opacity="0.3"/>
                                    <stop offset="100%" stop-color="#4285F4" stop-opacity="0.03"/>
                                </linearGradient>
                            </defs>
                            ${weightTicks.map(v => `
                                <line x1="${padL}" y1="${syW(v)}" x2="${W - padR}" y2="${syW(v)}" stroke="var(--c-border)" stroke-width="0.5" stroke-dasharray="3,3"/>
                                <text x="${padL - 6}" y="${syW(v) + 3.5}" text-anchor="end" fill="var(--c-text3)" font-size="8">${v}</text>
                            `).join('')}
                            ${chartEntries.map((e, i) => {
                                const barH = (e.steps || 0) / maxS * ch;
                                return `<rect x="${sx(i) - barW / 2}" y="${padT + ch - barH}" width="${barW}" height="${barH}" fill="#34A853" opacity="0.18" rx="1"/>`;
                            }).join('')}
                            ${areaPoly ? `<polygon points="${areaPoly}" fill="url(#gradWeight)"/>` : ''}
                            ${weightLine ? `<polyline points="${weightLine}" fill="none" stroke="#4285F4" stroke-width="1.8" stroke-linejoin="round"/>` : ''}
                            ${chartEntries.map((e, i) => e.weight != null ? `<circle cx="${sx(i)}" cy="${syW(e.weight)}" r="2.5" fill="#4285F4" stroke="var(--c-surface)" stroke-width="1.5"/>` : '').join('')}
                            ${chartEntries.map((e, i) => {
                                const d = new Date(e.date + 'T00:00:00');
                                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                const label = chartEntries.length <= 10 ? `${months[d.getMonth()]} ${d.getDate()}` : (i % Math.ceil(chartEntries.length / 7) === 0 ? `${months[d.getMonth()]} ${d.getDate()}` : '');
                                return label ? `<text x="${sx(i)}" y="${H - 8}" text-anchor="middle" fill="var(--c-text3)" font-size="8">${label}</text>` : '';
                            }).join('')}
                        </svg>
                    </div>
                    <div style="display: flex; gap: 16px; margin-top: 12px; justify-content: center; font-size: 0.75rem; color: var(--c-text2);">
                        <span style="display: flex; align-items: center; gap: 5px;">
                            <span style="width: 8px; height: 3px; border-radius: 2px; background: #4285F4;"></span>
                            Weight (kg)
                        </span>
                        <span style="display: flex; align-items: center; gap: 5px;">
                            <span style="width: 8px; height: 8px; border-radius: 2px; background: #34A853; opacity: 0.35;"></span>
                            Steps
                        </span>
                    </div>
                </div>
            `;
        }
        
        contentArea.innerHTML = `
            <div class="section-header">
                <div class="section-title" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                    <span>Health & Wellness</span>
                    ${streakHtml}
                </div>
                <button class="btn btn-primary" onclick="showHealthForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Log Entry
                </button>
            </div>
            
            ${stats.current && stats.current.entries_count ? `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
                    <span style="font-size:.75rem;color:var(--c-text3);margin-right:4px;">Range:</span>
                    ${HEALTH_RANGE_OPTIONS.map(d => {
                        const label = d === 0 ? 'All' : (d >= 365 ? '1y' : `${d}d`);
                        const active = healthRangeDays === d;
                        return `<button class="pill ${active ? 'active' : ''}" onclick="setHealthRange(${d})" style="padding:4px 12px;font-size:.75rem;">${label}</button>`;
                    }).join('')}
                </div>
                <div class="card-grid" style="margin-bottom: 32px;">
                    ${(() => {
                        const wDelta = buildDelta(stats.current.avg_weight, stats.previous.avg_weight);
                        const sDelta = buildDelta(stats.current.avg_sleep, stats.previous.avg_sleep);
                        const stDelta = buildDelta(stats.current.avg_steps, stats.previous.avg_steps);
                        const woDelta = buildDelta(stats.current.total_workout, stats.previous.total_workout);
                        const weightSpark = buildSparkline((stats.daily || []).map(d => d.weight), '#4285F4');
                        const sleepSpark = buildSparkline((stats.daily || []).map(d => d.sleep).filter(v => v != null), '#9334E6');
                        const stepsSpark = buildSparkline((stats.daily || []).map(d => d.steps || 0), '#34A853');
                        const workoutSpark = buildSparkline((stats.daily || []).map(d => d.workout_minutes || 0), '#FBBC05');
                        return `
                            <div class="card">
                                <div class="card-title">Avg Weight</div>
                                <div class="card-value">${stats.current.avg_weight ? stats.current.avg_weight.toFixed(1) + ' kg' : 'N/A'}</div>
                                <div class="card-meta">${wDelta.html}</div>
                                ${weightSpark}
                            </div>
                            <div class="card">
                                <div class="card-title">Avg Sleep</div>
                                <div class="card-value">${stats.current.avg_sleep ? stats.current.avg_sleep.toFixed(1) + ' hrs' : 'N/A'}</div>
                                <div class="card-meta">${sDelta.html}</div>
                                ${sleepSpark}
                            </div>
                            <div class="card">
                                <div class="card-title">Avg Steps</div>
                                <div class="card-value">${stats.current.avg_steps ? Math.round(stats.current.avg_steps).toLocaleString() : 'N/A'}</div>
                                <div class="card-meta">${stDelta.html}</div>
                                ${stepsSpark}
                            </div>
                            <div class="card">
                                <div class="card-title">Workout</div>
                                <div class="card-value">${stats.current.total_workout || 0} min</div>
                                <div class="card-meta">${woDelta.html}</div>
                                ${workoutSpark}
                            </div>
                        `;
                    })()}
                </div>
            ` : (stats.entries_count ? `
                <div class="card-grid" style="margin-bottom: 32px;">
                    <div class="card"><div class="card-title">Avg Weight</div><div class="card-value">${stats.avg_weight ? stats.avg_weight + ' kg' : 'N/A'}</div></div>
                    <div class="card"><div class="card-title">Avg Sleep</div><div class="card-value">${stats.avg_sleep ? stats.avg_sleep + ' hrs' : 'N/A'}</div></div>
                    <div class="card"><div class="card-title">Avg Steps</div><div class="card-value">${stats.avg_steps ? stats.avg_steps.toLocaleString() : 'N/A'}</div></div>
                    <div class="card"><div class="card-title">Workout</div><div class="card-value">${stats.total_workout || 0} min</div></div>
                </div>
            ` : '')}
            
            ${trendChart}
            
            ${entries.length > 0 ? `
                <div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 0.875rem; color: var(--c-text2);">From</label>
                        <input type="date" id="healthDateFrom" class="form-control" style="width: auto;" onchange="filterHealthEntries()">
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <label style="font-size: 0.875rem; color: var(--c-text2);">To</label>
                        <input type="date" id="healthDateTo" class="form-control" style="width: auto;" onchange="filterHealthEntries()">
                    </div>
                </div>
            ` : ''}
            
            <div id="healthTableContainer">
                ${renderHealthTable(entries)}
            </div>

            ${renderSamsungImportCard()}
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function renderSamsungImportCard() {
    return `
        <div class="card" style="margin-top: 32px;">
            <div class="section-title" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
                <span>Samsung Health import</span>
                <button class="btn btn-secondary" onclick="showSamsungExportWalkthrough()" title="Step-by-step guide to export from Samsung Health">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Get my Samsung data
                </button>
            </div>
            <p style="color: var(--c-text2); font-size: 0.875rem; margin-bottom: 16px;">
                Upload the ZIP you exported from Samsung Health. <strong>Preview</strong> shows what will be imported
                (a per-day breakdown below). <strong>Confirm</strong> writes to OneLife — your existing values are
                never overwritten; Samsung only fills gaps.
            </p>
            <div id="samsungDropZone" style="border: 2px dashed var(--c-border); border-radius: var(--r); padding: 24px; text-align: center; cursor: pointer; transition: all 0.2s;" onclick="document.getElementById('samsungFileInput').click()" ondragover="event.preventDefault(); this.style.borderColor='var(--c-primary)'; this.style.background='var(--c-surface2)';" ondragleave="this.style.borderColor='var(--c-border)'; this.style.background='';" ondrop="event.preventDefault(); this.style.borderColor='var(--c-border)'; this.style.background=''; if (event.dataTransfer.files.length) { document.getElementById('samsungFileInput').files = event.dataTransfer.files; onSamsungFileChosen({target: {files: event.dataTransfer.files}}); }">
                <input type="file" id="samsungFileInput" accept=".zip,application/zip" style="display: none" onchange="onSamsungFileChosen(event)">
                <div id="samsungDropMsg" style="color: var(--c-text2);">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 8px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <div>Drop a Samsung Health ZIP here, or click to browse</div>
                    <div style="font-size: 0.75rem; margin-top: 4px; opacity: 0.7;">Accepts <code>*.zip</code> from Samsung Health's "Download personal data" export</div>
                </div>
            </div>
            <div id="samsungImportPreview" style="display: none; margin-top: 16px;"></div>
        </div>
    `;
}

function showSamsungExportWalkthrough() {
    openModal('How to export your data from Samsung Health', `
        <div style="line-height: 1.6; font-size: 0.9rem;">
            <p style="margin-bottom: 16px; color: var(--c-text2);">Follow these steps on your Samsung phone. Total time: about 2 minutes. You'll get an email with a download link (or the ZIP will save to your phone's storage).</p>
            <ol style="padding-left: 20px;">
                <li style="margin-bottom: 12px;">
                    Open <strong>Samsung Health</strong> on your phone (the blue/green heart icon — not Health Connect).
                </li>
                <li style="margin-bottom: 12px;">
                    Tap the <strong>menu</strong> button (☰) at the bottom, or your <strong>profile icon</strong> at the top right.
                </li>
                <li style="margin-bottom: 12px;">
                    Tap the <strong>gear icon</strong> (⚙) to open Settings.
                </li>
                <li style="margin-bottom: 12px;">
                    Scroll down to <strong>"Download personal data"</strong> (older versions say "Export data" or "Request your data").
                </li>
                <li style="margin-bottom: 12px;">
                    Select <strong>"All data"</strong> (or the categories you want — Steps, Heart rate, Sleep, Exercise, Weight all work).
                </li>
                <li style="margin-bottom: 12px;">
                    Tap <strong>Download</strong> or <strong>Request</strong>. Samsung emails you a link, OR the ZIP is saved to your phone's <em>Downloads</em> folder.
                </li>
                <li style="margin-bottom: 12px;">
                    <strong>Transfer the ZIP to this PC:</strong>
                    <ul style="margin-top: 6px; padding-left: 20px;">
                        <li>Email it to yourself, open the link on this PC</li>
                        <li>Upload to Google Drive / OneDrive / Dropbox, download here</li>
                        <li>USB cable — phone → PC, copy from <code>Downloads</code></li>
                    </ul>
                </li>
                <li style="margin-bottom: 12px;">
                    Back on this page, <strong>drop the ZIP</strong> on the upload zone above (or click to browse). Click <strong>Preview</strong> to see what will be imported. Click <strong>Confirm</strong> to actually import.
                </li>
            </ol>
            <div style="background: var(--c-surface2); padding: 12px; border-radius: var(--r); margin-top: 16px; font-size: 0.8125rem; color: var(--c-text2);">
                <strong>Tip:</strong> Repeat this whenever you want fresh data — weekly or monthly. The import is idempotent: re-importing the same ZIP won't create duplicates.
            </div>
            <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
                <button class="btn btn-primary" onclick="closeModal()">Got it</button>
            </div>
        </div>
    `);
}

let samsungSelectedFile = null;

function onSamsungFileChosen(event) {
    const file = event.target.files[0];
    if (!file) return;
    samsungSelectedFile = file;
    const msg = document.getElementById('samsungDropMsg');
    if (msg) {
        msg.innerHTML = `
            <div style="font-weight: 500; color: var(--c-text);">${escapeHtml(file.name)}</div>
            <div style="font-size: 0.8125rem; margin-top: 4px; color: var(--c-text2);">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
        `;
    }
    const preview = document.getElementById('samsungImportPreview');
    if (preview) {
        preview.style.display = 'block';
        preview.innerHTML = `
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-primary" onclick="previewSamsungImport()">Preview</button>
                <button class="btn btn-secondary" onclick="clearSamsungFile()">Clear</button>
                <span style="font-size: 0.8125rem; color: var(--c-text2);">Preview first, then confirm if it looks right.</span>
            </div>
        `;
    }
}

function clearSamsungFile() {
    samsungSelectedFile = null;
    const input = document.getElementById('samsungFileInput');
    if (input) input.value = '';
    const msg = document.getElementById('samsungDropMsg');
    if (msg) {
        msg.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; margin-bottom: 8px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <div>Drop a Samsung Health ZIP here, or click to browse</div>
            <div style="font-size: 0.75rem; margin-top: 4px; opacity: 0.7;">Accepts <code>*.zip</code> from Samsung Health's "Download personal data" export</div>
        `;
    }
    const preview = document.getElementById('samsungImportPreview');
    if (preview) {
        preview.style.display = 'none';
        preview.innerHTML = '';
    }
}

async function previewSamsungImport() {
    if (!samsungSelectedFile) return;
    const preview = document.getElementById('samsungImportPreview');
    preview.innerHTML = '<div class="empty-state">Parsing...</div>';
    try {
        const fd = new FormData();
        fd.append('file', samsungSelectedFile);
        const r = await fetch('/api/health/import-samsung', { method: 'POST', body: fd });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        preview.innerHTML = renderSamsungPreview(body);
    } catch (e) {
        preview.innerHTML = `<div class="empty-state" style="color: var(--c-danger);">Preview failed: ${escapeHtml(e.message)}</div>`;
    }
}

async function confirmSamsungImport() {
    if (!samsungSelectedFile) return;
    const preview = document.getElementById('samsungImportPreview');
    const buttons = preview.querySelectorAll('button');
    buttons.forEach(b => b.disabled = true);
    try {
        const fd = new FormData();
        fd.append('file', samsungSelectedFile);
        const r = await fetch('/api/health/import-samsung?confirm=true', { method: 'POST', body: fd });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
        preview.insertAdjacentHTML('beforeend', `
            <div style="margin-top: 16px; padding: 12px; background: var(--c-success-bg, #e6f4ea); border-radius: var(--r); color: var(--c-text);">
                <strong>Imported.</strong> Health entries: ${body.written.health_entries || 0} written, ${body.skipped.health_entries || 0} unchanged.
                Heart rate samples: ${body.written.heart_rate_samples || 0}. Sleep sessions: ${body.written.sleep_sessions || 0}.
                <button class="btn btn-sm btn-primary" style="margin-left: 8px;" onclick="renderHealth()">Refresh page</button>
            </div>
        `);
    } catch (e) {
        preview.insertAdjacentHTML('beforeend', `
            <div style="margin-top: 16px; padding: 12px; background: var(--c-danger-bg, #fce8e6); border-radius: var(--r); color: var(--c-text);">
                <strong>Import failed:</strong> ${escapeHtml(e.message)}
            </div>
        `);
        buttons.forEach(b => b.disabled = false);
    }
}

function renderSamsungPreview(body) {
    const s = body.summary || {};
    const range = s.date_range || {};
    const start = range.start || '?';
    const end = range.end || '?';
    const days = s.per_day || [];
    const skipped = s.files_skipped_names || [];

    let html = `
        <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; font-size: 0.875rem;">
            <div><strong>${days.length}</strong> days</div>
            <div><strong>${start}</strong> to <strong>${end}</strong></div>
            <div><strong>${(s.total_steps || 0).toLocaleString()}</strong> total steps</div>
            <div><strong>${s.total_heart_rate_samples || 0}</strong> HR samples</div>
            <div><strong>${s.total_sleep_sessions || 0}</strong> sleep sessions</div>
            <div><strong>${s.files_seen || 0}</strong> files seen, <strong>${s.files_skipped || 0}</strong> skipped</div>
        </div>
    `;

    if (skipped.length) {
        html += `<div style="margin-bottom: 12px; padding: 8px 12px; background: var(--c-surface2); border-radius: var(--r); font-size: 0.8125rem;">Skipped: ${skipped.map(escapeHtml).join(', ')}</div>`;
    }

    if (days.length === 0) {
        html += `<div class="empty-state">No day-level data found in the ZIP. The export might be empty or use an unsupported format.</div>`;
        return html;
    }

    html += `
        <div style="overflow-x: auto; max-height: 400px; overflow-y: auto; border: 1px solid var(--c-border); border-radius: var(--r);">
        <table style="width: 100%; font-size: 0.8125rem; border-collapse: collapse;">
            <thead style="position: sticky; top: 0; background: var(--c-surface); z-index: 1;">
                <tr style="border-bottom: 1px solid var(--c-border);">
                    <th style="text-align: left; padding: 8px;">Date</th>
                    <th style="text-align: right; padding: 8px;">Steps</th>
                    <th style="text-align: right; padding: 8px;">Distance</th>
                    <th style="text-align: right; padding: 8px;">HR (avg)</th>
                    <th style="text-align: right; padding: 8px;">HR range</th>
                    <th style="text-align: right; padding: 8px;">Sleep</th>
                    <th style="text-align: right; padding: 8px;">Weight</th>
                    <th style="text-align: right; padding: 8px;">Water</th>
                    <th style="text-align: right; padding: 8px;">Workout</th>
                    <th style="text-align: right; padding: 8px;">Cal in</th>
                    <th style="text-align: right; padding: 8px;">Cal out</th>
                    <th style="text-align: left; padding: 8px;">Exercise / notes</th>
                </tr>
            </thead>
            <tbody>
    `;
    for (const d of days) {
        const hrRange = (d.heart_rate_min != null && d.heart_rate_max != null)
            ? `${d.heart_rate_min}-${d.heart_rate_max}`
            : (d.heart_rate_samples > 0 ? '?' : '-');
        const sleepHrs = d.sleep_minutes != null ? (d.sleep_minutes / 60).toFixed(1) + 'h' : '-';
        const weight = d.weight != null ? d.weight.toFixed(1) + ' kg' : '-';
        const water = d.water_liters != null ? d.water_liters.toFixed(2) + ' L' : '-';
        const workout = d.workout_minutes != null ? d.workout_minutes + ' min' : '-';
        const calIn = d.calories_in != null ? d.calories_in : '-';
        const calOut = d.calories_out != null ? d.calories_out : '-';
        const exTypes = d.exercises_detail && d.exercises_detail.length
            ? d.exercises_detail.map(e => `${escapeHtml(e.type)} (${e.duration_minutes}m)`).join(', ')
            : '-';
        const warnings = d.warnings && d.warnings.length
            ? `<br><span style="color: var(--c-warning, #f57c00); font-size: 0.75rem;">⚠ ${d.warnings.map(escapeHtml).join('; ')}</span>`
            : '';
        html += `
            <tr style="border-bottom: 1px solid var(--c-border);">
                <td style="padding: 6px 8px;">${escapeHtml(d.date)}</td>
                <td style="padding: 6px 8px; text-align: right;">${(d.steps || 0).toLocaleString()}</td>
                <td style="padding: 6px 8px; text-align: right;">${d.distance_km != null ? d.distance_km.toFixed(2) + ' km' : '-'}</td>
                <td style="padding: 6px 8px; text-align: right;">${d.heart_rate_avg != null ? d.heart_rate_avg + ' bpm' : (d.heart_rate_samples > 0 ? d.heart_rate_samples + ' samples' : '-')}</td>
                <td style="padding: 6px 8px; text-align: right; font-family: var(--font-mono, monospace);">${hrRange}</td>
                <td style="padding: 6px 8px; text-align: right;">${sleepHrs}</td>
                <td style="padding: 6px 8px; text-align: right;">${weight}</td>
                <td style="padding: 6px 8px; text-align: right;">${water}</td>
                <td style="padding: 6px 8px; text-align: right;">${workout}</td>
                <td style="padding: 6px 8px; text-align: right;">${calIn}</td>
                <td style="padding: 6px 8px; text-align: right;">${calOut}</td>
                <td style="padding: 6px 8px; font-size: 0.75rem;">${exTypes}${warnings}</td>
            </tr>
        `;
    }
    html += `</tbody></table></div>`;

    html += `
        <div style="display: flex; gap: 8px; margin-top: 16px; align-items: center;">
            <button class="btn btn-primary" onclick="confirmSamsungImport()">Confirm import</button>
            <button class="btn btn-secondary" onclick="clearSamsungFile()">Cancel</button>
            <span style="font-size: 0.8125rem; color: var(--c-text2);">Existing user-entered values are preserved.</span>
        </div>
    `;
    return html;
}

// ==================== SETTINGS ====================

let _settingsCache = null;  // last fetched settings, used to detect dirty state

async function renderSettings() {
    contentArea.innerHTML = `
        <div class="card" style="display:flex;align-items:center;gap:14px">
            <div class="skeleton" style="width:200px;height:24px;border-radius:var(--r)"></div>
        </div>
        <div class="grid-2">
            <div class="card"><div class="skeleton" style="height:200px"></div></div>
            <div class="card"><div class="skeleton" style="height:200px"></div></div>
        </div>
    `;
    try {
        const [data, serverInfo] = await Promise.all([
            api('/settings'),
            api('/server-info'),
        ]);
        _settingsCache = data;
        contentArea.innerHTML = `
            <div class="grid-2" style="align-items: start;">
                ${data.groups.map(g => renderSettingsGroup(data.settings[g.id] || [], g)).join('')}
            </div>
            ${renderServerInfoCard(serverInfo)}
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error loading settings: ${escapeHtml(error.message)}</div>`;
    }
}

function renderSettingsGroup(settings, group) {
    return `
        <div class="card">
            <div class="section-title" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <span>${escapeHtml(group.label)}</span>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span data-group-status="${escapeHtml(group.id)}" style="font-size: 0.75rem; color: var(--c-text2); min-height: 1em;"></span>
                    <button class="btn btn-sm btn-primary" onclick="saveSettingsGroup('${escapeHtml(group.id)}', this)">Save</button>
                </div>
            </div>
            <div style="display: flex; flex-direction: column;">
                ${settings.map(renderSettingField).join('')}
            </div>
        </div>
    `;
}

function renderSettingField(s) {
    const id = `setting-${s.key}`;
    let controlWidth = '180px';
    let control = '';
    if (s.type === 'bool') {
        controlWidth = '44px';
        const active = s.value ? 'active' : '';
        const checked = s.value ? 'checked' : '';
        const ariaChecked = s.value ? 'true' : 'false';
        control = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span class="toggle-switch ${active}" data-toggle-for="${escapeHtml(s.key)}" onclick="toggleSettingSwitch('${escapeHtml(s.key)}', event)" role="switch" aria-checked="${ariaChecked}" tabindex="0" style="cursor: pointer;"></span>
                <input type="checkbox" id="${id}" data-key="${escapeHtml(s.key)}" data-type="bool" ${checked} style="position: absolute; opacity: 0; pointer-events: none;">
                <label for="${id}" data-toggle-label-for="${escapeHtml(s.key)}" style="font-size: 0.8125rem; color: var(--c-text2); cursor: pointer; user-select: none;">${s.value ? 'Enabled' : 'Disabled'}</label>
            </div>
        `;
    } else if (s.type === 'choice') {
        control = `
            <select class="form-control" id="${id}" data-key="${escapeHtml(s.key)}" data-type="choice" style="width: ${controlWidth};">
                ${s.choices.map(c => `<option value="${escapeHtml(c.value)}" ${String(s.value) === String(c.value) ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
            </select>
        `;
    } else if (s.type === 'int' || s.type === 'float') {
        const step = s.type === 'float' ? '0.1' : '1';
        const min = s.min != null ? `min="${s.min}"` : '';
        const max = s.max != null ? `max="${s.max}"` : '';
        controlWidth = '120px';
        control = `
            <input type="number" class="form-control" id="${id}" data-key="${escapeHtml(s.key)}" data-type="${s.type}" step="${step}" ${min} ${max} value="${escapeHtml(String(s.value))}" style="width: ${controlWidth}; text-align: right;">
        `;
    } else {
        controlWidth = '140px';
        const max = s.max != null ? `maxlength="${s.max}"` : '';
        control = `
            <input type="text" class="form-control" id="${id}" data-key="${escapeHtml(s.key)}" data-type="string" ${max} value="${escapeHtml(String(s.value))}" style="width: ${controlWidth};">
        `;
    }
    return `
        <div style="display: grid; grid-template-columns: 1fr ${controlWidth}; gap: 8px 16px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--c-border);">
            <div style="min-width: 0;">
                <label for="${id}" style="display: block; font-weight: 500; font-size: 0.875rem; color: var(--c-text); cursor: pointer;">${escapeHtml(s.label)}</label>
                ${s.help ? `<div class="form-help" style="margin-top: 2px;">${escapeHtml(s.help)}</div>` : ''}
            </div>
            <div style="display: flex; justify-content: flex-end;">${control}</div>
        </div>
    `;
}

function toggleSettingSwitch(key, evt) {
    if (evt) {
        evt.preventDefault();
        evt.stopPropagation();
    }
    const sw = document.querySelector(`[data-toggle-for="${key}"]`);
    const cb = document.querySelector(`input[data-key="${key}"][data-type="bool"]`);
    const label = document.querySelector(`[data-toggle-label-for="${key}"]`);
    if (!sw || !cb) return;
    const next = !cb.checked;
    cb.checked = next;
    sw.classList.toggle('active', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    if (label) label.textContent = next ? 'Enabled' : 'Disabled';
}

function renderServerInfoCard(info) {
    return `
        <div class="card">
            <div class="section-title" style="display: flex; align-items: center; justify-content: space-between;">
                <span>Server info</span>
                <button class="btn btn-sm btn-secondary" onclick="resetAllSettings()">Reset to defaults</button>
            </div>
            <p class="form-help" style="margin: -4px 0 12px;">For the Health Connect Android companion app. The server URL below is what you paste into the app's settings.</p>
            <dl style="display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; margin: 0; font-size: 0.875rem;">
                <dt style="color: var(--c-text2);">Server URL</dt>
                <dd style="margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <code id="serverUrlBox" style="background: var(--c-surface2); padding: 4px 8px; border-radius: var(--r-xs); font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${escapeHtml(info.server_url)}</code>
                    <button class="btn btn-sm btn-secondary" onclick="copyToClipboard('serverUrlBox', this)">Copy</button>
                </dd>
                <dt style="color: var(--c-text2);">Ingest token</dt>
                <dd style="margin: 0;">${info.ingest_token_set
                    ? '<span class="badge badge-success">Set in environment</span>'
                    : '<span class="badge badge-warning">Not set</span>'}</dd>
                <dt style="color: var(--c-text2);">Secret key</dt>
                <dd style="margin: 0;">${info.secret_key_set
                    ? '<span class="badge badge-success">Set</span>'
                    : '<span class="badge badge-warning">Auto-generated</span>'}</dd>
            </dl>
        </div>
    `;
}

function _readSettingField(input) {
    const key = input.dataset.key;
    const type = input.dataset.type;
    if (type === 'bool') return [key, input.checked];
    if (type === 'int') return [key, parseInt(input.value, 10)];
    if (type === 'float') return [key, parseFloat(input.value)];
    return [key, input.value];
}

async function saveSettingsGroup(groupId, btn) {
    const card = btn.closest('.card');
    const inputs = card.querySelectorAll('input[data-key], select[data-key]');
    const payload = {};
    inputs.forEach(inp => {
        const [k, v] = _readSettingField(inp);
        payload[k] = v;
    });
    const status = card.querySelector(`[data-group-status="${groupId}"]`);
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Saving…';
    status.textContent = '';
    try {
        const r = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const body = await r.json();
        if (!r.ok) {
            const details = (body.details || []).join('; ');
            status.textContent = '✗ ' + (details || body.error || 'Error');
            status.style.color = 'var(--g-red, #ef4444)';
            return;
        }
        status.textContent = '✓ Saved';
        status.style.color = 'var(--g-green, #10b981)';
        setTimeout(() => { status.textContent = ''; }, 2500);
        _applySettingSideEffects(payload);
    } catch (e) {
        status.textContent = '✗ ' + e.message;
        status.style.color = 'var(--g-red, #ef4444)';
    } finally {
        btn.textContent = prev;
        btn.disabled = false;
    }
}

function _applySettingSideEffects(payload) {
    if ('theme' in payload) {
        const t = String(payload.theme);
        if (t === 'auto') {
            const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', sysDark ? 'dark' : 'light');
            localStorage.removeItem('onelife-theme');
        } else {
            document.documentElement.setAttribute('data-theme', t);
            localStorage.setItem('onelife-theme', t);
        }
    }
    if ('currency_symbol' in payload) {
        localStorage.setItem('onelife-currency-symbol', String(payload.currency_symbol));
    }
    if ('currency_code' in payload) {
        localStorage.setItem('onelife-currency-code', String(payload.currency_code));
    }
    if ('date_format' in payload) {
        localStorage.setItem('onelife-date-format', String(payload.date_format));
    }
    if ('first_day_of_week' in payload) {
        localStorage.setItem('onelife-fdow', String(payload.first_day_of_week));
    }
    if ('tz_offset_minutes' in payload) {
        localStorage.setItem('onelife-tz-offset', String(payload.tz_offset_minutes));
    }
    if ('hide_net_worth_on_dashboard' in payload) {
        if (currentSection === 'dashboard') renderDashboard();
    }
}

async function resetAllSettings() {
    if (!confirm('Reset all settings to defaults? This does not affect your data.')) return;
    try {
        const r = await fetch('/api/settings/reset', { method: 'POST' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        renderSettings();
        showToast('Settings reset to defaults');
    } catch (e) {
        showToast('Reset failed: ' + e.message, 'error');
    }
}

async function copyToClipboard(elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.textContent || el.value;
    const restore = () => {
        const orig = btn.dataset.label || btn.textContent;
        btn.textContent = orig;
    };
    btn.dataset.label = btn.dataset.label || btn.textContent;
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied!';
    } catch (e) {
        const r = document.createRange();
        r.selectNode(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        try { document.execCommand('copy'); } catch (_) {}
        sel.removeAllRanges();
        btn.textContent = 'Copied!';
    }
    setTimeout(restore, 1500);
}

function showHealthForm(id = null) {
    // For simplicity, we'll fetch the entry if editing
    const fetchAndShow = async () => {
        let entry = null;
        if (id) {
            entry = await api(`/health/${id}`);
        }
        
        openModal(id ? 'Edit Health Entry' : 'Log Health Entry', `
            <form id="healthForm" onsubmit="saveHealthEntry(event, ${id || 'null'})">
                <div class="form-group">
                    <label class="form-label" for="health_date">Date <span class="required-mark">*</span></label>
                    <input type="date" class="form-control" id="health_date" name="date" value="${entry?.date || new Date().toISOString().split('T')[0]}" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="health_weight">Weight (kg)</label>
                        <input type="number" step="0.1" class="form-control" id="health_weight" name="weight" value="${entry?.weight || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="health_steps">Steps</label>
                        <input type="number" class="form-control" id="health_steps" name="steps" value="${entry?.steps || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="health_distance_km">Distance (km)</label>
                        <input type="number" step="0.01" class="form-control" id="health_distance_km" name="distance_km" value="${entry?.distance_km || ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="health_workout_minutes">Workout (minutes)</label>
                        <input type="number" class="form-control" id="health_workout_minutes" name="workout_minutes" value="${entry?.workout_minutes || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="health_sleep_hours">Sleep (hours)</label>
                        <input type="number" step="0.1" class="form-control" id="health_sleep_hours" name="sleep_hours" value="${entry?.sleep_hours || ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="health_water_liters">Water (liters)</label>
                        <input type="number" step="0.1" class="form-control" id="health_water_liters" name="water_liters" value="${entry?.water_liters || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="health_mood">Mood</label>
                        <select class="form-control" id="health_mood" name="mood">
                            <option value="">Select...</option>
                            <option value="amazing" ${entry?.mood === 'amazing' ? 'selected' : ''}>Amazing</option>
                            <option value="good" ${entry?.mood === 'good' ? 'selected' : ''}>Good</option>
                            <option value="okay" ${entry?.mood === 'okay' ? 'selected' : ''}>Okay</option>
                            <option value="bad" ${entry?.mood === 'bad' ? 'selected' : ''}>Bad</option>
                            <option value="terrible" ${entry?.mood === 'terrible' ? 'selected' : ''}>Terrible</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="health_calories_in">Calories In</label>
                        <input type="number" class="form-control" id="health_calories_in" name="calories_in" value="${entry?.calories_in || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="health_calories_out">Calories Out</label>
                        <input type="number" class="form-control" id="health_calories_out" name="calories_out" value="${entry?.calories_out || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label" for="health_notes">Notes</label>
                    <textarea class="form-control" id="health_notes" name="notes">${escapeHtml(entry?.notes || '')}</textarea>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Entry</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveHealthEntry(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        date: form.date.value,
        weight: form.weight.value ? parseFloat(form.weight.value) : null,
        steps: form.steps.value ? parseInt(form.steps.value) : null,
        distance_km: form.distance_km?.value ? parseFloat(form.distance_km.value) : null,
        workout_minutes: form.workout_minutes.value ? parseInt(form.workout_minutes.value) : null,
        sleep_hours: form.sleep_hours.value ? parseFloat(form.sleep_hours.value) : null,
        water_liters: form.water_liters.value ? parseFloat(form.water_liters.value) : null,
        mood: form.mood.value || null,
        calories_in: form.calories_in.value ? parseInt(form.calories_in.value) : null,
        calories_out: form.calories_out.value ? parseInt(form.calories_out.value) : null,
        notes: form.notes.value || null
    };
    
    try {
        if (id) {
            await api(`/health/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Entry updated');
        } else {
            await api('/health', { method: 'POST', body: JSON.stringify(data) });
            showToast('Entry logged');
        }
        closeModal();
        renderHealth();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteHealthEntry(id) {
    if (!confirm('Delete this entry?')) return;
    try {
        await api(`/health/${id}`, { method: 'DELETE' });
        showToast('Entry deleted');
        renderHealth();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== FINANCE ====================

let transactionsData = [];
let currentFinanceMonth = new Date().toISOString().slice(0, 7);
let selectedCategoryFilter = null;
let currentCategoryBreakdown = [];
let currentTotalExpense = 0;

function renderFinanceDonutChart(categoryBreakdown, totalExpense) {
    if (!categoryBreakdown || categoryBreakdown.length === 0 || totalExpense <= 0) {
        return '<div class="empty-state" style="padding: 24px;">No expenses to chart</div>';
    }

    const colors = [
        '#f43f5e', // Rose
        '#3b82f6', // Blue
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#8b5cf6', // Violet
        '#ec4899', // Pink
        '#06b6d4', // Cyan
        '#f97316', // Orange
        '#14b8a6', // Teal
        '#6b7280'  // Gray
    ];

    let currentOffset = 0;
    const r = 50;
    const circ = 2 * Math.PI * r;
    
    const slicesHtml = categoryBreakdown.map((c, idx) => {
        const pct = c.amount / totalExpense;
        const dashArray = `${pct * circ} ${circ}`;
        const dashOffset = -currentOffset * circ;
        currentOffset += pct;
        const color = colors[idx % colors.length];
        
        return `
            <circle class="donut-slice ${selectedCategoryFilter === c.category ? 'active' : ''}"
                    cx="100" cy="100" r="${r}"
                    fill="transparent"
                    stroke="${color}"
                    stroke-width="20"
                    stroke-dasharray="${dashArray}"
                    stroke-dashoffset="${dashOffset}"
                    transform="rotate(-90 100 100)"
                    onclick="filterTransactionsByCategory('${escapeHtml(c.category).replace(/'/g, "\\'")}')"
                    onmouseenter="hoverDonutSlice('${escapeHtml(c.category).replace(/'/g, "\\'")}', '${fmtVndPlain(c.amount)}', ${(pct * 100).toFixed(1)}, '${color}')"
                    onmouseleave="leaveDonutSlice()">
            </circle>
        `;
    }).join('');

    const legendHtml = categoryBreakdown.map((c, idx) => {
        const pct = (c.amount / totalExpense * 100).toFixed(1);
        const color = colors[idx % colors.length];
        const isActive = selectedCategoryFilter === c.category;
        return `
            <div class="legend-item"
                 style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.8125rem; padding: 4px 8px; border-radius: var(--r-sm); cursor: pointer; transition: background var(--tr); ${isActive ? 'background: var(--c-primary-bg); font-weight: 600;' : ''}"
                 onclick="filterTransactionsByCategory('${escapeHtml(c.category).replace(/'/g, "\\'")}')"
                 onmouseenter="hoverDonutSlice('${escapeHtml(c.category).replace(/'/g, "\\'")}', '${fmtVndPlain(c.amount)}', ${pct}, '${color}')"
                 onmouseleave="leaveDonutSlice()">
                <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></span>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(c.category)}</span>
                </div>
                <div style="text-align: right; flex-shrink: 0; color: var(--c-text2);">${pct}%</div>
            </div>
        `;
    }).join('');

    return `
        <div style="display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center; padding: 10px 0;">
            <div style="position: relative; width: 200px; height: 200px;">
                <svg width="200" height="200" viewBox="0 0 200 200" style="display: block;">
                    <circle cx="100" cy="100" r="${r}" fill="transparent" stroke="var(--c-surface2)" stroke-width="20"></circle>
                    ${slicesHtml}
                </svg>
                <div id="donutCenterText" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; text-align: center;">
                    <div id="donutCenterLabel" style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text3);">Total Expense</div>
                    <div id="donutCenterValue" style="font-size: 1rem; font-weight: 700; color: var(--c-text);">${fmtVnd(totalExpense)}</div>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; width: 100%;">
                ${legendHtml}
            </div>
        </div>
    `;
}

function hoverDonutSlice(category, amountStr, pct, color) {
    const label = document.getElementById('donutCenterLabel');
    const val = document.getElementById('donutCenterValue');
    if (label && val) {
        label.innerText = category;
        label.style.color = color;
        val.innerText = `${amountStr} (${pct}%)`;
    }
}

function leaveDonutSlice() {
    const label = document.getElementById('donutCenterLabel');
    const val = document.getElementById('donutCenterValue');
    if (label && val) {
        if (selectedCategoryFilter) {
            const cItem = currentCategoryBreakdown.find(c => c.category === selectedCategoryFilter);
            if (cItem) {
                const total = currentTotalExpense;
                const pct = (cItem.amount / total * 100).toFixed(1);
                label.innerText = cItem.category;
                label.style.color = 'var(--c-primary)';
                val.innerHTML = `${fmtVnd(cItem.amount)} <span style="color:var(--c-text3);font-size:0.85em">(${pct}%)</span>`;
                return;
            }
        }
        label.innerText = 'Total Expense';
        label.style.color = 'var(--c-text3)';
        val.innerHTML = fmtVnd(currentTotalExpense);
    }
}

function filterTransactionsByCategory(category) {
    const tableBody = document.querySelector('#financeTransactionsTable tbody');
    if (!tableBody) return;

    const filterIndicator = document.getElementById('financeTransactionsFilterIndicator');

    if (selectedCategoryFilter === category) {
        selectedCategoryFilter = null;
        if (filterIndicator) {
            filterIndicator.style.display = 'none';
            filterIndicator.innerHTML = '';
        }
    } else {
        selectedCategoryFilter = category;
        if (filterIndicator) {
            filterIndicator.style.display = 'flex';
            filterIndicator.style.alignItems = 'center';
            filterIndicator.style.justifyContent = 'space-between';
            filterIndicator.style.background = 'var(--c-primary-bg)';
            filterIndicator.style.border = '1px solid var(--c-primary)';
            filterIndicator.style.color = 'var(--g-blue)';
            filterIndicator.style.padding = '8px 12px';
            filterIndicator.style.borderRadius = 'var(--r-sm)';
            filterIndicator.style.marginBottom = '12px';
            filterIndicator.style.fontSize = '0.8125rem';
            filterIndicator.innerHTML = `
                <span>Filter Active: Showing only <strong>${escapeHtml(category)}</strong> transactions</span>
                <button class="btn btn-sm btn-ghost" onclick="filterTransactionsByCategory('${escapeHtml(category)}')" style="padding: 2px 8px; font-size: 0.75rem; color: var(--g-blue);">Reset Filter</button>
            `;
        }
    }

    const rows = tableBody.querySelectorAll('tr');
    rows.forEach(row => {
        const catBadge = row.querySelector('.badge');
        if (catBadge) {
            const rowCat = catBadge.textContent.trim();
            if (!selectedCategoryFilter || rowCat === selectedCategoryFilter) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    });

    const chartContainer = document.getElementById('financeDonutChartContainer');
    if (chartContainer) {
        chartContainer.innerHTML = renderFinanceDonutChart(currentCategoryBreakdown, currentTotalExpense);
    }
}

window.hoverDonutSlice = hoverDonutSlice;
window.leaveDonutSlice = leaveDonutSlice;
window.filterTransactionsByCategory = filterTransactionsByCategory;

async function renderFinance() {
    contentArea.innerHTML = `<div class="section-header"><div><h2 class="section-title" style="font-size:1.75rem;margin-bottom:4px"><div class="skeleton" style="width:200px;height:30px"></h2></div><div class="skeleton" style="width:300px;height:16px"></div></div><div style="display:flex;gap:12px"><div class="skeleton" style="width:120px;height:36px;border-radius:var(--r)"></div><div class="skeleton" style="width:100px;height:36px;border-radius:var(--r)"></div></div></div><div class="card" style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);margin-bottom:24px;padding:24px"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:24px"><div><div class="skeleton" style="width:140px;height:14px;margin-bottom:8px;opacity:0.7"></div><div class="skeleton" style="width:180px;height:40px;opacity:0.7"></div></div><div><div class="skeleton" style="width:120px;height:14px;margin-bottom:8px;opacity:0.7"></div><div class="skeleton" style="width:130px;height:28px;opacity:0.7"></div></div></div><div style="margin-top:24px"><div class="skeleton" style="width:100%;height:8px;border-radius:4px;opacity:0.7"></div></div></div><div class="card" style="margin-bottom:24px;border-left:4px solid #10b981"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:1.125rem;font-weight:600"><div class="skeleton" style="width:140px;height:18px"></div></h3><div class="skeleton" style="width:100px;height:24px"></div></div><div class="table-container"><table><thead><tr><th><div class="skeleton" style="width:130px;height:16px"></div></th><th><div class="skeleton" style="width:70px;height:16px"></div></th><th style="text-align:right"><div class="skeleton" style="width:50px;height:16px;margin-left:auto"></div></th><th style="text-align:right;width:180px"><div class="skeleton" style="width:100px;height:16px;margin-left:auto"></div></th><th style="width:80px"><div class="skeleton" style="width:40px;height:16px"></div></th></tr></thead><tbody><tr><td><div class="skeleton" style="width:100px;height:16px"></div></td><td><div class="skeleton" style="width:80px;height:16px"></div></td><td style="text-align:right"><div class="skeleton" style="width:70px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:120px;height:28px;margin-left:auto;border-radius:var(--r)"></div></td><td><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div></td></tr><tr><td><div class="skeleton" style="width:120px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:16px"></div></td><td style="text-align:right"><div class="skeleton" style="width:70px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:120px;height:28px;margin-left:auto;border-radius:var(--r)"></div></td><td><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div></td></tr></tbody></table></div></div><div class="card" style="margin-bottom:24px;border-left:4px solid #3b82f6"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:1.125rem;font-weight:600"><div class="skeleton" style="width:180px;height:18px"></div></h3><div><div class="skeleton" style="width:100px;height:24px"></div><div class="skeleton" style="width:80px;height:14px;margin-top:4px;margin-left:auto"></div></div></div><div class="table-container"><table><thead><tr><th><div class="skeleton" style="width:60px;height:16px"></div></th><th><div class="skeleton" style="width:50px;height:16px"></div></th><th><div class="skeleton" style="width:40px;height:16px"></div></th><th style="text-align:right"><div class="skeleton" style="width:100px;height:16px;margin-left:auto"></div></th><th style="text-align:right"><div class="skeleton" style="width:50px;height:16px;margin-left:auto"></div></th><th style="text-align:right"><div class="skeleton" style="width:50px;height:16px;margin-left:auto"></div></th><th style="text-align:right;width:180px"><div class="skeleton" style="width:100px;height:16px;margin-left:auto"></div></th><th style="width:80px"><div class="skeleton" style="width:60px;height:16px"></div></th></tr></thead><tbody><tr><td><div class="skeleton" style="width:100px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:50px;height:16px"></div></td><td style="text-align:right"><div class="skeleton" style="width:80px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:70px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:70px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:120px;height:28px;margin-left:auto;border-radius:var(--r)"></div></td><td><div style="display:flex;gap:4px"><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></td></tr><tr><td><div class="skeleton" style="width:120px;height:16px"></div></td><td><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></td><td><div class="skeleton" style="width:50px;height:16px"></div></td><td style="text-align:right"><div class="skeleton" style="width:80px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:70px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:70px;height:16px;margin-left:auto"></div></td><td style="text-align:right"><div class="skeleton" style="width:120px;height:28px;margin-left:auto;border-radius:var(--r)"></div></td><td><div style="display:flex;gap:4px"><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></td></tr></tbody></table></div></div>`;
    
    try {
        const [summary, budgets, assets, trend, transactions] = await Promise.all([
            api('/finance/summary'),
            api('/budgets'),
            api('/assets'),
            api('/finance/monthly-trend'),
            api(`/transactions?month=${currentFinanceMonth}`)
        ]);
        
        selectedCategoryFilter = null;
        currentCategoryBreakdown = summary.category_breakdown || [];
        currentTotalExpense = summary.month_expense || 0;
        
        const totalNetWorth = summary.total_net_worth || 0;
        const cashValue = summary.cash?.value || 0;
        const invValue = summary.investments?.value || 0;
        const totalGain = summary.total_unrealized_gain || 0;
        const totalCost = summary.total_cost || 0;
        
        // Asset type colors
        const typeColors = {
            cash: '#34A853', savings: '#34A853', stock: '#4285F4', crypto: '#A142F4',
            real_estate: '#FBBC05', vehicle: '#EA4335', gold: '#FBBC05',
            certificate: '#FA7B17', bond: '#4285F4', other: '#9AA0A6'
        };
        
        // Build portfolio HTML
        const cashAssets = assets.filter(a => a.asset_type === 'cash' || a.asset_type === 'savings');
        const invAssets = assets.filter(a => !['cash', 'savings'].includes(a.asset_type));
        
        contentArea.innerHTML = `
            <div class="section-header">
                <div>
                    <h2 class="section-title" style="font-size: 1.75rem; margin-bottom: 4px;">Asset Tracker</h2>
                    <div style="color: var(--c-text2); font-size: 0.9375rem;">Manage your entire portfolio in one place</div>
                </div>
                <div style="display: flex; gap: 12px;">
                    <button class="btn btn-primary" onclick="showTransactionForm()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Transaction
                    </button>
                    <button class="btn btn-success" onclick="showAssetForm()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Add Asset
                    </button>
                </div>
            </div>
            
            <!-- Net Worth Hero -->
            <div class="card" style="background: linear-gradient(135deg, var(--c-surface2) 0%, var(--c-border) 100%); color: var(--c-text); margin-bottom: 24px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 24px;">
                    <div>
                        <div style="font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; margin-bottom: 8px;">Total Net Worth</div>
                        <div style="font-size: 2.5rem; font-weight: 700;">${fmtVnd(totalNetWorth)}</div>
                        <div style="display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--c-success);"></span>
                                <span style="opacity: 0.8;">Cash ${fmtVnd(cashValue)}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--c-primary);"></span>
                                <span style="opacity: 0.8;">Investments ${fmtVnd(invValue)}</span>
                            </div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; margin-bottom: 8px;">Unrealized P/L</div>
                        <div style="font-size: 1.75rem; font-weight: 700; color: ${totalGain >= 0 ? '#4ade80' : '#f87171'};">
                            ${totalGain >= 0 ? '+' : ''}${fmtVnd(totalGain)}
                        </div>
                        <div style="font-size: 0.9375rem; opacity: 0.8;">
                            ${totalCost > 0 ? ((totalGain / totalCost) * 100).toFixed(1) + '%' : '0%'} total return
                        </div>
                    </div>
                </div>
                
                <!-- Allocation bars -->
                <div style="margin-top: 24px;">
                    <div style="display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--c-surface2);">
                        ${summary.asset_breakdown.map(a => {
                            const pct = totalNetWorth > 0 ? (a.value / totalNetWorth * 100) : 0;
                            return pct > 0 ? `<div style="width: ${pct}%; background: ${typeColors[a.type] || '#94a3b8'};" title="${a.type}: ${pct.toFixed(1)}%"></div>` : '';
                        }).join('')}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px;">
                        ${summary.asset_breakdown.map(a => {
                            const pct = totalNetWorth > 0 ? (a.value / totalNetWorth * 100) : 0;
                            return `<div style="display: flex; align-items: center; gap: 6px; font-size: 0.8125rem;">
                                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${typeColors[a.type] || '#94a3b8'};"></span>
                                <span>${a.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} ${pct.toFixed(0)}%</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            
            <!-- Cash Position -->
            <div class="card" style="margin-bottom: 24px; border-left: 4px solid #10b981;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="font-size: 1.125rem; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: #10b981;"></span>
                        Cash Position
                    </h3>
                    <div style="font-size: 1.5rem; font-weight: 700; color: #10b981;">${fmtVnd(cashValue)}</div>
                </div>
                ${cashAssets.length > 0 ? `
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Account / Asset</th>
                                    <th>Platform</th>
                                    <th style="text-align: right;">Value</th>
                                    <th style="text-align: right; width: 180px;">Quick Update</th>
                                    <th style="width: 80px;"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${cashAssets.map(a => `
                                    <tr>
                                        <td><strong>${escapeHtml(a.name)}</strong></td>
                                        <td>${escapeHtml(a.broker_platform || '-')}</td>
                                        <td style="text-align: right; font-weight: 600;">${fmtVnd(a.current_value)}</td>
                                        <td style="text-align: right;">
                                            <div style="display: flex; gap: 4px; justify-content: flex-end;">
                                                <input type="number" id="quickVal-${a.id}" value="${a.current_value}" 
                                                    style="width: 120px; padding: 4px 8px; border: 1px solid var(--c-border); border-radius: var(--r-sm); font-size: 0.875rem;"
                                                    onkeydown="if(event.key==='Enter')quickUpdateValue(${a.id})">
                                                <button class="btn btn-sm btn-success" onclick="quickUpdateValue(${a.id})" title="Update value">&#10003;</button>
                                            </div>
                                        </td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="showAssetForm(${a.id})">Edit</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div class="empty-state" style="padding: 24px;">No cash accounts tracked. Add your bank accounts, cash on hand, etc.</div>'}
            </div>
            
            <!-- Investment Portfolio -->
            <div class="card" style="margin-bottom: 24px; border-left: 4px solid #3b82f6;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="font-size: 1.125rem; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: #3b82f6;"></span>
                        Investment Portfolio
                    </h3>
                    <div style="text-align: right;">
                        <div style="font-size: 1.5rem; font-weight: 700;">${fmtVnd(invValue)}</div>
                        <div style="font-size: 0.875rem; color: ${(summary.investments?.gain || 0) >= 0 ? 'var(--c-success)' : 'var(--c-danger)'};">
                            ${(summary.investments?.gain || 0) >= 0 ? '+' : ''}${fmtVnd(summary.investments?.gain || 0)}
                        </div>
                    </div>
                </div>
                
                <!-- Type breakdown for investments -->
                ${summary.asset_breakdown.filter(a => !['cash', 'savings'].includes(a.type)).length > 0 ? `
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">
                        ${summary.asset_breakdown.filter(a => !['cash', 'savings'].includes(a.type)).map(a => {
                            const pct = invValue > 0 ? (a.value / invValue * 100) : 0;
                            return `
                                <div style="background: var(--c-surface2); padding: 14px; border-radius: var(--r); border: 1px solid var(--c-border);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <span style="font-size: 0.8125rem; font-weight: 600; text-transform: uppercase; color: var(--c-text2);">${a.type.replace('_', ' ')}</span>
                                        <span style="font-size: 0.75rem; color: var(--c-text3);">${a.count} items</span>
                                    </div>
                                    <div style="font-size: 1.125rem; font-weight: 700; margin-bottom: 4px;">${fmtVnd(a.value)}</div>
                                    <div style="font-size: 0.8125rem; color: ${a.gain >= 0 ? 'var(--c-success)' : 'var(--c-danger)'};">
                                        ${a.gain >= 0 ? '+' : ''}${fmtVnd(a.gain)}
                                    </div>
                                    <div class="progress-bar" style="margin-top: 8px; height: 4px;">
                                        <div class="progress-fill" style="width: ${pct}%; background: ${typeColors[a.type] || '#3b82f6'};"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : ''}
                
                ${invAssets.length > 0 ? `
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Asset</th>
                                    <th>Type</th>
                                    <th>Qty</th>
                                    <th style="text-align: right;">Current Value</th>
                                    <th style="text-align: right;">Cost</th>
                                    <th style="text-align: right;">P/L</th>
                                    <th style="text-align: right; width: 180px;">Quick Update</th>
                                    <th style="width: 80px;"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${invAssets.map(a => `
                                    <tr>
                                        <td>
                                            <strong>${escapeHtml(a.name)}</strong>
                                            ${a.broker_platform ? `<div style="font-size: 0.75rem; color: var(--c-text3);">${escapeHtml(a.broker_platform)}</div>` : ''}
                                        </td>
                                        <td><span class="badge badge-secondary badge-dot">${a.asset_type.replace('_', ' ')}</span></td>
                                        <td>${a.quantity} ${a.unit || ''}</td>
                                        <td style="text-align: right; font-weight: 600;">${fmtVnd(a.current_value)}</td>
                                        <td style="text-align: right;">${fmtVnd(a.cost_basis)}</td>
                                        <td style="text-align: right; color: ${a.gain_loss >= 0 ? 'var(--c-success)' : 'var(--c-danger)'}; font-weight: 600;">
                                            ${a.gain_loss >= 0 ? '+' : ''}${fmtVnd(a.gain_loss)}
                                            <div style="font-size: 0.75rem; opacity: 0.7;">${a.gain_loss_percent}%</div>
                                        </td>
                                        <td style="text-align: right;">
                                            <div style="display: flex; gap: 4px; justify-content: flex-end;">
                                                <input type="number" id="quickVal-${a.id}" value="${a.current_value}" 
                                                    style="width: 120px; padding: 4px 8px; border: 1px solid var(--c-border); border-radius: var(--r-sm); font-size: 0.875rem;"
                                                    onkeydown="if(event.key==='Enter')quickUpdateValue(${a.id})">
                                                <button class="btn btn-sm btn-success" onclick="quickUpdateValue(${a.id})" title="Update value">&#10003;</button>
                                            </div>
                                        </td>
                                        <td>
                                            <button class="btn btn-sm btn-secondary" onclick="showAssetForm(${a.id})">Edit</button>
                                            <button class="btn-icon btn-danger-icon" onclick="deleteAsset(${a.id})" title="Delete" aria-label="Delete">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div class="empty-state" style="padding: 24px;">No investments tracked. Add stocks, crypto, real estate, gold, etc.</div>'}
            </div>
            
            <!-- Monthly Cashflow -->
            <div style="margin-top: 32px;">
                <h3 class="section-title" style="margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text2);">Monthly Cashflow</span>
                    <input type="month" class="form-control" value="${currentFinanceMonth}" onchange="changeFinanceMonth(this.value)" style="width: auto; font-size: 0.875rem; padding: 4px 10px;">
                </h3>
                <div class="card-grid" style="margin-bottom: 24px;">
                    <div class="card" style="border-left: 3px solid #34A853;">
                        <div class="card-title">Income</div>
                        <div class="card-value" style="font-size: 1.5rem; color: #34A853;">${fmtVnd(summary.month_income)}</div>
                    </div>
                    <div class="card" style="border-left: 3px solid #EA4335;">
                        <div class="card-title">Expenses</div>
                        <div class="card-value" style="font-size: 1.5rem; color: #EA4335;">${fmtVnd(summary.month_expense)}</div>
                    </div>
                    <div class="card" style="border-left: 3px solid #4285F4;">
                        <div class="card-title">Cashflow</div>
                        <div class="card-value" style="font-size: 1.5rem; color: ${summary.month_balance >= 0 ? '#34A853' : '#EA4335'};">${fmtVnd(summary.month_balance)}</div>
                    </div>
                </div>
                
                <!-- Monthly Spending Trend -->
                <div class="card" style="margin-bottom: 24px;">
                    <h3 class="section-title" style="margin-bottom: 16px; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: #4285F4;"></span>
                        12-Month Income & Expense Trend
                    </h3>
                    ${trend && trend.length > 1 ? (() => {
                        const maxVal = Math.max(...trend.flatMap(t => [t.income, t.expense]), 1);
                        const w = 600, h = 200, padL = 50, padR = 16, padT = 20, padB = 30;
                        const cw = w - padL - padR, ch = h - padT - padB;
                        const stepX = cw / (trend.length - 1);
                        const scaleY = (v) => padT + ch - (v / maxVal * ch);
                        const incPts = trend.map((t, i) => `${padL + i * stepX},${scaleY(t.income)}`).join(' ');
                        const expPts = trend.map((t, i) => `${padL + i * stepX},${scaleY(t.expense)}`).join(' ');
                        const yTicks = 5;
                        const yLabels = [];
                        for (let i = 0; i <= yTicks; i++) {
                            yLabels.push(Math.round(maxVal * i / yTicks));
                        }
                        return `
                            <div style="overflow-x: auto;">
                                <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="min-width: ${w}px;">
                                    <!-- Grid lines -->
                                    ${yLabels.map((v, i) => {
                                        const y = scaleY(v);
                                        return `
                                            <line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--c-border)" stroke-width="1" stroke-dasharray="4,4"/>
                                            <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="var(--c-text3)" font-size="10">${formatCurrencyShort(v)}</text>
                                        `;
                                    }).join('')}
                                    <!-- X axis labels -->
                                    ${trend.map((t, i) => `
                                        <text x="${padL + i * stepX}" y="${h - 4}" text-anchor="${i === 0 ? 'start' : i === trend.length - 1 ? 'end' : 'middle'}" fill="var(--c-text3)" font-size="9">${t.label}</text>
                                    `).join('')}
                                    <!-- Income area fill -->
                                    <polygon points="${padL},${padT + ch} ${incPts} ${padL + (trend.length - 1) * stepX},${padT + ch}" fill="#34A853" opacity="0.08"/>
                                    <!-- Expense area fill -->
                                    <polygon points="${padL},${padT + ch} ${expPts} ${padL + (trend.length - 1) * stepX},${padT + ch}" fill="#EA4335" opacity="0.08"/>
                                    <!-- Income line -->
                                    <polyline points="${incPts}" fill="none" stroke="#34A853" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                                    <!-- Expense line -->
                                    <polyline points="${expPts}" fill="none" stroke="#EA4335" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                                    <!-- Dots -->
                                    ${trend.map((t, i) => `
                                        <circle cx="${padL + i * stepX}" cy="${scaleY(t.income)}" r="3" fill="#34A853" stroke="var(--c-surface)" stroke-width="2"/>
                                        <circle cx="${padL + i * stepX}" cy="${scaleY(t.expense)}" r="3" fill="#EA4335" stroke="var(--c-surface)" stroke-width="2"/>
                                    `).join('')}
                                </svg>
                            </div>
                            <div style="display: flex; gap: 24px; margin-top: 12px; justify-content: center; font-size: 0.875rem;">
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <span style="width: 12px; height: 3px; border-radius: 2px; background: #34A853;"></span>
                                    Income
                                </span>
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <span style="width: 12px; height: 3px; border-radius: 2px; background: #EA4335;"></span>
                                    Expenses
                                </span>
                            </div>
                        `;
                    })() : '<div class="empty-state" style="padding: 24px;">Add transactions to see spending trends</div>'}
                </div>
                
                <!-- Recent Transactions -->
                <div class="card" style="margin-bottom: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <h3 class="section-title" style="margin-bottom: 0;">Recent Transactions</h3>
                        <button class="btn btn-primary btn-sm" onclick="showTransactionForm()">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Add
                        </button>
                    </div>
                    <div id="financeTransactionsFilterIndicator" style="display: none;"></div>
                    ${transactions.length > 0 ? `
                        <div class="table-container" id="financeTransactionsTable">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Category</th>
                                        <th>Description</th>
                                        <th>Account</th>
                                        <th style="text-align: right;">Amount</th>
                                        <th style="width: 100px;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${transactions.slice(0, 20).map(t => `
                                        <tr>
                                            <td>${formatDate(t.date)}</td>
                                            <td><span class="badge badge-secondary badge-dot">${escapeHtml(t.category)}</span></td>
                                            <td>${escapeHtml(t.description || '-')}</td>
                                            <td>${t.asset_name ? `<span class="tag">${escapeHtml(t.asset_name)}</span>` : '<span style="color:var(--c-text3)">—</span>'}</td>
                                            <td style="text-align: right; font-weight: 600; color: ${t.type === 'income' ? 'var(--c-success)' : 'var(--c-danger)'};">
                                                ${t.type === 'income' ? '+' : '-'}${fmtVnd(t.amount)}
                                            </td>
                                            <td style="text-align: right;">
                                                <button class="btn btn-sm btn-secondary" onclick="showTransactionForm(${t.id})">Edit</button>
                                                <button class="btn-icon btn-danger-icon" onclick="deleteTransaction(${t.id})" title="Delete" aria-label="Delete">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                                </button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : '<div class="empty-state" style="padding: 24px;">No transactions yet. Record your first income or expense.</div>'}
                </div>
                
                <div class="grid-2" style="margin-bottom: 32px;">
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <h3 class="section-title" style="margin-bottom: 0; font-size: 1rem;">Budget Overview</h3>
                            <button class="btn btn-sm btn-secondary" onclick="showBudgetEditor()">Edit Budgets</button>
                        </div>
                        ${budgets.map(b => {
                            const percent = b.budget_limit > 0 ? (b.spent / b.budget_limit * 100) : 0;
                            return `
                                <div style="margin-bottom: 14px;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span style="font-weight: 500; font-size: 0.9375rem;">${escapeHtml(b.name)}</span>
                                        <span style="font-size: 0.8125rem; color: var(--c-text2);">${fmtVnd(b.spent)} / ${fmtVnd(b.budget_limit)}</span>
                                    </div>
                                    <div class="progress-bar">
                                        <div class="progress-fill ${percent > 100 ? 'danger' : percent > 80 ? 'warning' : 'safe'}" style="width: ${Math.min(percent, 100)}%; ${percent <= 80 && b.color ? `background: ${b.color};` : ''}"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div>
                        <h3 class="section-title" style="margin-bottom: 16px; font-size: 1rem;">Expense Breakdown</h3>
                        <div id="financeDonutChartContainer">
                            ${renderFinanceDonutChart(currentCategoryBreakdown, currentTotalExpense)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function changeFinanceMonth(month) {
    currentFinanceMonth = month;
    renderFinance();
}

function showTransactionForm(id = null) {
    const fetchAndShow = async () => {
        let tx = null;
        if (id) {
            tx = await api(`/transactions/${id}`);
        }

        const assets = await api('/assets');
        const defaultAssetId = assets.find(a => a.asset_type === 'cash' || a.asset_type === 'savings')?.id
            || assets[0]?.id
            || '';

        openModal(id ? 'Edit Transaction' : 'New Transaction', `
            <form id="transactionForm" onsubmit="saveTransaction(event, ${id || 'null'})" data-validate="true">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Type <span class="required-mark">*</span></label>
                        <select class="form-control" name="type" required>
                            <option value="expense" ${!tx || tx?.type === 'expense' ? 'selected' : ''}>Expense</option>
                            <option value="income" ${tx?.type === 'income' ? 'selected' : ''}>Income</option>
                            <option value="transfer" ${tx?.type === 'transfer' ? 'selected' : ''}>Transfer</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Amount <span class="required-mark">*</span></label>
                        <input type="number" class="form-control" name="amount" value="${tx?.amount || ''}" placeholder="0" min="0" step="1000" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Date <span class="required-mark">*</span></label>
                        <input type="date" class="form-control" name="date" value="${tx?.date || new Date().toISOString().split('T')[0]}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Category <span class="required-mark">*</span></label>
                        <select class="form-control" name="category" required>
                            <option value="">Select...</option>
                            <option value="food" ${tx?.category === 'food' ? 'selected' : ''}>Food & Dining</option>
                            <option value="transport" ${tx?.category === 'transport' ? 'selected' : ''}>Transport</option>
                            <option value="shopping" ${tx?.category === 'shopping' ? 'selected' : ''}>Shopping</option>
                            <option value="bills" ${tx?.category === 'bills' ? 'selected' : ''}>Bills & Utilities</option>
                            <option value="health" ${tx?.category === 'health' ? 'selected' : ''}>Health</option>
                            <option value="entertainment" ${tx?.category === 'entertainment' ? 'selected' : ''}>Entertainment</option>
                            <option value="salary" ${tx?.category === 'salary' ? 'selected' : ''}>Salary</option>
                            <option value="freelance" ${tx?.category === 'freelance' ? 'selected' : ''}>Freelance</option>
                            <option value="investment" ${tx?.category === 'investment' ? 'selected' : ''}>Investment</option>
                            <option value="other" ${tx?.category === 'other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <input type="text" class="form-control" name="description" value="${escapeHtml(tx?.description || '')}" placeholder="Optional note">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Account <span class="form-help">(updates balance)</span></label>
                        <select class="form-control" name="asset_id">
                            <option value="">— None —</option>
                            ${assets.map(a => `<option value="${a.id}" ${(tx?.asset_id || defaultAssetId) == a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.asset_type)})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Payment Method</label>
                        <select class="form-control" name="payment_method">
                            <option value="">Select...</option>
                            <option value="cash" ${tx?.payment_method === 'cash' ? 'selected' : ''}>Cash</option>
                            <option value="credit" ${tx?.payment_method === 'credit' ? 'selected' : ''}>Credit Card</option>
                            <option value="debit" ${tx?.payment_method === 'debit' ? 'selected' : ''}>Debit Card</option>
                            <option value="transfer" ${tx?.payment_method === 'transfer' ? 'selected' : ''}>Bank Transfer</option>
                            <option value="other" ${tx?.payment_method === 'other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
    };

    fetchAndShow();
}

async function saveTransaction(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        type: form.type.value,
        amount: parseFloat(form.amount.value),
        date: form.date.value,
        category: form.category.value,
        description: form.description.value || null,
        payment_method: form.payment_method.value || null,
        asset_id: form.asset_id.value ? parseInt(form.asset_id.value) : null
    };
    
    try {
        if (id) {
            await api(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Transaction updated');
        } else {
            await api('/transactions', { method: 'POST', body: JSON.stringify(data) });
            showToast('Transaction added');
        }
        closeModal();
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteTransaction(id) {
    if (!confirm('Delete this transaction?')) return;
    let snapshot = null;
    try {
        const all = await api(`/transactions?month=${currentFinanceMonth}`);
        snapshot = (all || []).find(t => t.id === id) || null;
        await api(`/transactions/${id}`, { method: 'DELETE' });
        showToast('Transaction deleted', 'success', {
            duration: 6000,
            undo: async () => {
                if (!snapshot) return;
                const { id: _drop, ...payload } = snapshot;
                await api('/transactions', { method: 'POST', body: JSON.stringify(payload) });
                showToast('Transaction restored', 'success');
                renderFinance();
            }
        });
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== BUDGET MANAGEMENT ====================

async function showBudgetEditor() {
    try {
        const budgets = await api('/budgets');
        openModal('Manage Budgets', `
            <div id="budgetEditorList">
                ${budgets.map(b => `
                    <div class="budget-editor-item" data-id="${b.id}" style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--c-border);">
                        <input type="color" value="${b.color || '#4285F4'}" style="width: 36px; height: 36px; border: none; border-radius: var(--r-sm); cursor: pointer; padding: 0;" title="Color">
                        <div style="flex: 1; display: flex; gap: 10px; align-items: center;">
                            <input type="text" class="form-control" value="${escapeHtml(b.name)}" placeholder="Name" style="flex: 1;">
                            <input type="number" class="form-control" value="${b.budget_limit}" placeholder="Limit" min="0" style="width: 140px;">
                        </div>
                        <button class="btn btn-sm btn-secondary" onclick="saveBudget(${b.id})" title="Save">Save</button>
                        <button class="btn-icon btn-danger-icon" onclick="deleteBudget(${b.id})" title="Delete" aria-label="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                        </button>
                    </div>
                `).join('')}
            </div>
            <button class="btn btn-primary" onclick="createBudget()" style="margin-top: 16px; width: 100%;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Category
            </button>
        `);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function saveBudget(id) {
    const item = document.querySelector(`.budget-editor-item[data-id="${id}"]`);
    if (!item) return;
    const inputs = item.querySelectorAll('input');
    const color = inputs[0].value;
    const name = inputs[1].value.trim();
    const budget_limit = parseFloat(inputs[2].value) || 0;

    if (!name) { showToast('Name is required', 'error'); return; }

    try {
        await api(`/budgets/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name, budget_limit, color })
        });
        showToast('Budget updated');
        closeModal();
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function createBudget() {
    try {
        await api('/budgets', {
            method: 'POST',
            body: JSON.stringify({ name: 'New Category', budget_limit: 0, color: '#4285F4' })
        });
        showToast('Budget created');
        closeModal();
        showBudgetEditor();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteBudget(id) {
    if (!confirm('Delete this budget category?')) return;
    try {
        await api(`/budgets/${id}`, { method: 'DELETE' });
        showToast('Budget deleted');
        closeModal();
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== ASSETS ====================

function showAssetForm(id = null) {
    const fetchAndShow = async () => {
        let asset = null;
        if (id) {
            asset = await api(`/assets/${id}`);
        }
        
        openModal(id ? 'Edit Asset' : 'Add Asset', `
            <form id="assetForm" onsubmit="saveAsset(event, ${id || 'null'})">
                <div class="form-group">
                    <label class="form-label">Asset Name <span class="required-mark">*</span></label>
                    <input type="text" class="form-control" name="name" value="${escapeHtml(asset?.name || '')}" placeholder="e.g., Apple Stock, Bitcoin, Condo, Cash" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Asset Type <span class="required-mark">*</span></label>
                        <select class="form-control" name="asset_type" required>
                            <option value="cash" ${asset?.asset_type === 'cash' ? 'selected' : ''}>Cash / Bank</option>
                            <option value="stock" ${asset?.asset_type === 'stock' ? 'selected' : ''}>Stock / ETF</option>
                            <option value="crypto" ${asset?.asset_type === 'crypto' ? 'selected' : ''}>Crypto</option>
                            <option value="certificate" ${asset?.asset_type === 'certificate' ? 'selected' : ''}>Investment Certificate</option>
                            <option value="bond" ${asset?.asset_type === 'bond' ? 'selected' : ''}>Bond / Fixed Income</option>
                            <option value="real_estate" ${asset?.asset_type === 'real_estate' ? 'selected' : ''}>Real Estate</option>
                            <option value="vehicle" ${asset?.asset_type === 'vehicle' ? 'selected' : ''}>Vehicle</option>
                            <option value="gold" ${asset?.asset_type === 'gold' ? 'selected' : ''}>Gold / Precious Metals</option>
                            <option value="savings" ${asset?.asset_type === 'savings' ? 'selected' : ''}>Savings Account</option>
                            <option value="other" ${asset?.asset_type === 'other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Broker / Platform</label>
                        <input type="text" class="form-control" name="broker_platform" value="${escapeHtml(asset?.broker_platform || '')}" placeholder="e.g., SSI, TCBS, Binance, Techcombank">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Quantity</label>
                        <input type="number" step="0.0001" class="form-control" name="quantity" value="${asset?.quantity || 1}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Unit</label>
                        <input type="text" class="form-control" name="unit" value="${escapeHtml(asset?.unit || 'VND')}" placeholder="VND, shares, coins, grams">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Current Value (VND) <span class="required-mark">*</span></label>
                        <input type="number" step="1000" class="form-control" name="current_value" value="${asset?.current_value || ''}" placeholder="Total current value in VND" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Cost Basis (VND)</label>
                        <input type="number" step="1000" class="form-control" name="cost_basis" value="${asset?.cost_basis || ''}" placeholder="Total amount you paid">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Notes</label>
                    <textarea class="form-control" name="notes" placeholder="Any extra details...">${escapeHtml(asset?.notes || '')}</textarea>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Asset</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveAsset(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        name: form.name.value,
        asset_type: form.asset_type.value,
        broker_platform: form.broker_platform.value || null,
        quantity: parseFloat(form.quantity.value) || 1,
        unit: form.unit.value || 'VND',
        current_value: parseFloat(form.current_value.value) || 0,
        cost_basis: parseFloat(form.cost_basis.value) || 0,
        notes: form.notes.value || null
    };
    
    try {
        if (id) {
            await api(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Asset updated');
        } else {
            await api('/assets', { method: 'POST', body: JSON.stringify(data) });
            showToast('Asset added');
        }
        closeModal();
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteAsset(id) {
    if (!confirm('Delete this asset?')) return;
    try {
        await api(`/assets/${id}`, { method: 'DELETE' });
        showToast('Asset deleted');
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function quickUpdateValue(id) {
    const input = document.getElementById(`quickVal-${id}`);
    if (!input) return;
    
    const newValue = parseFloat(input.value);
    if (isNaN(newValue) || newValue < 0) {
        showToast('Invalid value', 'error');
        return;
    }
    
    try {
        await api(`/assets/${id}/value`, {
            method: 'PATCH',
            body: JSON.stringify({ current_value: newValue })
        });
        showToast('Value updated');
        renderFinance();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== LEARNING ====================

let learnFilter = '';
let _learnItems = [];
let learnSearchQuery = '';

function filterLearning(status) {
    learnFilter = status;
    renderLearning();
}

function filterLearningLive(q) {
    learnSearchQuery = q.toLowerCase();
    const cards = document.querySelectorAll('.card-grid .card');
    cards.forEach(card => {
        const title = card.querySelector('h3')?.textContent?.toLowerCase() || '';
        const author = card.querySelector('p')?.textContent?.toLowerCase() || '';
        const notes = card.querySelector('div[id^="notes-"]')?.textContent?.toLowerCase() || '';
        const category = card.querySelector('p[style*="font-size: 0.8125rem;"]')?.textContent?.toLowerCase() || '';
        const matches = title.includes(learnSearchQuery) || author.includes(learnSearchQuery) || notes.includes(learnSearchQuery) || category.includes(learnSearchQuery);
        card.style.display = matches ? '' : 'none';
    });
}

async function renderLearning() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:190px;height:26px"></h2></div><div class="skeleton" style="width:100px;height:36px;border-radius:var(--r)"></div></div><div class="filters"><div class="skeleton" style="width:160px;height:38px;border-radius:var(--r)"></div><div class="skeleton" style="width:140px;height:38px;border-radius:var(--r)"></div></div><div class="card-grid"><div class="card" style="display:flex;flex-direction:column"><div style="display:flex;justify-content:space-between;margin-bottom:12px"><div class="skeleton" style="width:70px;height:22px;border-radius:999px"></div><div class="skeleton" style="width:60px;height:22px;border-radius:999px"></div></div><div class="skeleton" style="width:80%;height:18px;margin-bottom:8px"></div><div class="skeleton" style="width:60%;height:14px;margin-bottom:8px"></div><div class="skeleton" style="width:40%;height:14px;margin-bottom:12px"></div><div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><div class="skeleton" style="width:60px;height:13px"></div><div class="skeleton" style="width:40px;height:13px"></div></div><div class="progress-bar"><div class="skeleton" style="width:60%;height:8px;border-radius:999px"></div></div></div></div><div class="card" style="display:flex;flex-direction:column"><div style="display:flex;justify-content:space-between;margin-bottom:12px"><div class="skeleton" style="width:80px;height:22px;border-radius:999px"></div><div class="skeleton" style="width:70px;height:22px;border-radius:999px"></div></div><div class="skeleton" style="width:70%;height:18px;margin-bottom:8px"></div><div class="skeleton" style="width:50%;height:14px;margin-bottom:8px"></div><div class="skeleton" style="width:30%;height:14px;margin-bottom:12px"></div><div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><div class="skeleton" style="width:60px;height:13px"></div><div class="skeleton" style="width:40px;height:13px"></div></div><div class="progress-bar"><div class="skeleton" style="width:40%;height:8px;border-radius:999px"></div></div></div></div><div class="card" style="display:flex;flex-direction:column"><div style="display:flex;justify-content:space-between;margin-bottom:12px"><div class="skeleton" style="width:65px;height:22px;border-radius:999px"></div><div class="skeleton" style="width:55px;height:22px;border-radius:999px"></div></div><div class="skeleton" style="width:90%;height:18px;margin-bottom:8px"></div><div class="skeleton" style="width:55%;height:14px;margin-bottom:8px"></div><div class="skeleton" style="width:45%;height:14px;margin-bottom:12px"></div><div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><div class="skeleton" style="width:60px;height:13px"></div><div class="skeleton" style="width:40px;height:13px"></div></div><div class="progress-bar"><div class="skeleton" style="width:80%;height:8px;border-radius:999px"></div></div></div></div></div>`;
    
    try {
        const items = await api('/learning');
        _learnItems = items;
        let filtered = learnFilter ? items.filter(i => i.status === learnFilter) : items;
        if (learnSearchQuery) {
            filtered = filtered.filter(i => 
                i.title.toLowerCase().includes(learnSearchQuery) ||
                (i.author && i.author.toLowerCase().includes(learnSearchQuery)) ||
                (i.notes && i.notes.toLowerCase().includes(learnSearchQuery)) ||
                (i.category && i.category.toLowerCase().includes(learnSearchQuery))
            );
        }
        
        contentArea.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">Learning & Growth</h2>
                <button class="btn btn-primary" onclick="showLearningForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Item
                </button>
            </div>
            
            <div class="filters">
                <div class="pill-group" id="learnFilterPills">
                    <button class="pill ${!learnFilter ? 'active' : ''}" onclick="filterLearning('')">All</button>
                    <button class="pill ${learnFilter === 'in_progress' ? 'active' : ''}" onclick="filterLearning('in_progress')">In Progress</button>
                    <button class="pill ${learnFilter === 'completed' ? 'active' : ''}" onclick="filterLearning('completed')">Completed</button>
                    <button class="pill ${learnFilter === 'not_started' ? 'active' : ''}" onclick="filterLearning('not_started')">Not Started</button>
                </div>
                <div class="section-search-container">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="text" class="section-search-input" id="learnSearchInput" placeholder="Filter learning..." oninput="filterLearningLive(this.value)" value="${escapeHtml(learnSearchQuery)}">
                </div>
            </div>
            
            ${filtered.length > 0 ? `
                <div class="card-grid">
                    ${filtered.map(item => `
                        <div class="card" style="display: flex; flex-direction: column;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                                <span class="badge badge-${item.status === 'completed' ? 'success' : item.status === 'in_progress' ? 'info' : 'secondary'} badge-dot">${item.status.replace('_', ' ')}</span>
                                <span class="badge badge-secondary badge-dot">${item.item_type}</span>
                            </div>
                            <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 8px;">${escapeHtml(item.title)}</h3>
                            ${item.author ? `<p style="font-size: 0.875rem; color: var(--c-text2); margin-bottom: 8px;">by ${escapeHtml(item.author)}</p>` : ''}
                            ${item.category ? `<p style="font-size: 0.8125rem; color: var(--c-text3); margin-bottom: 12px;">${item.category}</p>` : ''}
                            ${item.progress > 0 ? `
                                <div style="margin-bottom: 12px;">
                                    <div style="display: flex; justify-content: space-between; font-size: 0.8125rem; margin-bottom: 4px;">
                                        <span>Progress</span>
                                        <span>${item.progress}%</span>
                                    </div>
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${item.progress}%"></div>
                                    </div>
                                </div>
                            ` : ''}
                            ${item.rating ? `<p style="font-size: 0.875rem; color: var(--c-warning); margin-bottom: 12px;">Rating: ${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</p>` : ''}
                            ${item.notes ? `
                                <div style="font-size: 0.875rem; color: var(--c-text2); margin-bottom: 12px; flex: 1;" id="notes-${item.id}">
                                    <span>${escapeHtml(item.notes.length > 150 ? item.notes.slice(0, 150) + '...' : item.notes)}</span>
                                    ${item.notes.length > 150 ? `<a href="#" onclick="event.preventDefault(); toggleLearnNotes(${item.id})" style="color: var(--c-primary); font-size: 0.8125rem; margin-left: 4px;">Read more</a>` : ''}
                                </div>
                            ` : '<div style="flex: 1;"></div>'}
                            <div style="display: flex; gap: 8px; margin-top: auto;">
                                <button class="btn btn-sm btn-secondary" onclick="showLearningForm(${item.id})">Edit</button>
                                <button class="btn-icon btn-danger-icon" onclick="deleteLearningItem(${item.id})" title="Delete" aria-label="Delete">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `<div class="empty-state">
                <div class="empty-state-illustration">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
                </div>
                <h3>No learning items</h3>
                <p>Capture the books, courses and skills you want to grow through.</p>
                <button class="btn btn-primary" onclick="showLearningForm()">Add Item</button>
            </div>`}
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function showLearningForm(id = null) {
    const fetchAndShow = async () => {
        let item = null;
        if (id) {
            item = await api(`/learning/${id}`);
        }
        
        openModal(id ? 'Edit Learning Item' : 'Add Learning Item', `
            <form id="learningForm" onsubmit="saveLearningItem(event, ${id || 'null'})">
                <div class="form-group">
                    <label class="form-label">Title <span class="required-mark">*</span></label>
                    <input type="text" class="form-control" name="title" value="${escapeHtml(item?.title || '')}" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Type <span class="required-mark">*</span></label>
                        <select class="form-control" name="item_type" required>
                            <option value="book" ${item?.item_type === 'book' ? 'selected' : ''}>Book</option>
                            <option value="course" ${item?.item_type === 'course' ? 'selected' : ''}>Course</option>
                            <option value="skill" ${item?.item_type === 'skill' ? 'selected' : ''}>Skill</option>
                            <option value="note" ${item?.item_type === 'note' ? 'selected' : ''}>Note</option>
                            <option value="article" ${item?.item_type === 'article' ? 'selected' : ''}>Article</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Status</label>
                        <select class="form-control" name="status">
                            <option value="not_started" ${item?.status === 'not_started' || !item ? 'selected' : ''}>Not Started</option>
                            <option value="in_progress" ${item?.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                            <option value="completed" ${item?.status === 'completed' ? 'selected' : ''}>Completed</option>
                            <option value="on_hold" ${item?.status === 'on_hold' ? 'selected' : ''}>On Hold</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Author/Instructor</label>
                        <input type="text" class="form-control" name="author" value="${escapeHtml(item?.author || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <input type="text" class="form-control" name="category" value="${escapeHtml(item?.category || '')}" placeholder="e.g., Programming, Design">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Progress (%)</label>
                        <input type="number" min="0" max="100" class="form-control" name="progress" value="${item?.progress || 0}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Rating (1-5)</label>
                        <input type="number" min="1" max="5" class="form-control" name="rating" value="${item?.rating || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">URL</label>
                    <input type="url" class="form-control" name="url" value="${escapeHtml(item?.url || '')}">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Start Date</label>
                        <input type="date" class="form-control" name="start_date" value="${item?.start_date || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">End Date</label>
                        <input type="date" class="form-control" name="end_date" value="${item?.end_date || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Notes</label>
                    <textarea class="form-control" name="notes">${escapeHtml(item?.notes || '')}</textarea>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveLearningItem(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        title: form.title.value,
        item_type: form.item_type.value,
        status: form.status.value,
        author: form.author.value || null,
        category: form.category.value || null,
        progress: parseInt(form.progress.value) || 0,
        rating: form.rating.value ? parseInt(form.rating.value) : null,
        url: form.url.value || null,
        start_date: form.start_date.value || null,
        end_date: form.end_date.value || null,
        notes: form.notes.value || null
    };
    
    try {
        if (id) {
            await api(`/learning/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Item updated');
        } else {
            await api('/learning', { method: 'POST', body: JSON.stringify(data) });
            showToast('Item added');
        }
        closeModal();
        renderLearning();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteLearningItem(id) {
    if (!confirm('Delete this item?')) return;
    try {
        await api(`/learning/${id}`, { method: 'DELETE' });
        showToast('Item deleted');
        renderLearning();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function toggleLearnNotes(id) {
    const el = document.getElementById(`notes-${id}`);
    if (!el) return;
    const item = _learnItems.find(i => i.id === id);
    if (!item || !item.notes) return;
    const isExpanded = el.dataset.expanded === '1';
    if (isExpanded) {
        el.innerHTML = `<span>${escapeHtml(item.notes.length > 150 ? item.notes.slice(0, 150) + '...' : item.notes)}</span><a href="#" onclick="event.preventDefault(); toggleLearnNotes(${id})" style="color: var(--c-primary); font-size: 0.8125rem; margin-left: 4px;">Read more</a>`;
        el.dataset.expanded = '0';
    } else {
        el.innerHTML = `<span>${escapeHtml(item.notes)}</span><a href="#" onclick="event.preventDefault(); toggleLearnNotes(${id})" style="color: var(--c-primary); font-size: 0.8125rem; margin-left: 4px;">Show less</a>`;
        el.dataset.expanded = '1';
    }
}

// ==================== CALENDAR ====================

let currentCalendarDate = new Date();
let calendarEvents = [];

async function renderCalendar() {
    contentArea.innerHTML = `<div class="section-header"><div style="display:flex;align-items:center;gap:16px"><h2 class="section-title"><div class="skeleton" style="width:180px;height:26px"></h2></div><div style="display:flex;gap:8px"><div class="skeleton" style="width:36px;height:36px;border-radius:var(--r)"></div><div class="skeleton" style="width:36px;height:36px;border-radius:var(--r)"></div><div class="skeleton" style="width:64px;height:36px;border-radius:var(--r)"></div></div></div><div class="skeleton" style="width:100px;height:36px;border-radius:var(--r)"></div></div><div class="grid-2"><div><div class="calendar-grid" style="margin-bottom:8px"><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div><div class="calendar-day-header"><div class="skeleton" style="width:24px;height:14px"></div></div></div><div class="calendar-grid"><div class="calendar-day other-month"></div><div class="calendar-day other-month"></div><div class="calendar-day other-month"></div><div class="calendar-day other-month"></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day"><div class="skeleton" style="width:18px;height:16px;margin-bottom:4px"></div></div><div class="calendar-day other-month"></div><div class="calendar-day other-month"></div></div></div><div><h2 class="section-title" style="margin-bottom:16px"><div class="skeleton" style="width:160px;height:18px"></h2></div><div class="list-item"><div class="list-item-info"><div class="list-item-title"><div class="skeleton" style="width:140px;height:16px"></div></div><div class="list-item-meta"><div class="skeleton" style="width:200px;height:14px;margin-top:4px"></div></div></div><div class="list-item-actions" style="display:flex;gap:8px"><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></div><div class="list-item"><div class="list-item-info"><div class="list-item-title"><div class="skeleton" style="width:120px;height:16px"></div></div><div class="list-item-meta"><div class="skeleton" style="width:180px;height:14px;margin-top:4px"></div></div></div><div class="list-item-actions" style="display:flex;gap:8px"><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></div><div class="list-item"><div class="list-item-info"><div class="list-item-title"><div class="skeleton" style="width:160px;height:16px"></div></div><div class="list-item-meta"><div class="skeleton" style="width:220px;height:14px;margin-top:4px"></div></div></div><div class="list-item-actions" style="display:flex;gap:8px"><div class="skeleton" style="width:40px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></div></div></div>`;
    
    try {
        const year = currentCalendarDate.getFullYear();
        const month = currentCalendarDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDayOfWeek = firstDay.getDay();
        
        const startDate = new Date(year, month, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
        
        const events = await api(`/events?start=${startDate}&end=${endDate}`);
        calendarEvents = events;
        const upcoming = await api('/events/upcoming');
        
        // Group events by day
        const eventsByDay = {};
        events.forEach(e => {
            const day = new Date(e.start_time).getDate();
            if (!eventsByDay[day]) eventsByDay[day] = [];
            eventsByDay[day].push(e);
        });
        
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        let daysHtml = '';
        
        // Empty cells before first day
        for (let i = 0; i < startDayOfWeek; i++) {
            daysHtml += `<div class="calendar-day other-month"></div>`;
        }
        
        // Days of month
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
            const dayEvents = eventsByDay[day] || [];
            
            daysHtml += `
                <div class="calendar-day ${isToday ? 'today' : ''}" onclick="showDayEvents(${year}, ${month}, ${day})" style="cursor: pointer;">
                    <div style="font-weight: 600; margin-bottom: 4px;">${day}</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 2px;">
                        ${dayEvents.slice(0, 3).map(e => `
                            <span class="calendar-event-dot" style="background: ${getEventColor(e.category)}"></span>
                        `).join('')}
                        ${dayEvents.length > 3 ? `<span style="font-size: 0.625rem; color: var(--c-text2);">+${dayEvents.length - 3}</span>` : ''}
                    </div>
                    ${dayEvents.slice(0, 2).map(e => `
                        <div style="font-size: 0.625rem; color: var(--c-text2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(e.title)}</div>
                    `).join('')}
                </div>
            `;
        }
        
        contentArea.innerHTML = `
            <div class="section-header">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <h2 class="section-title">${monthNames[month]} ${year}</h2>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-sm btn-secondary" onclick="changeMonth(-1)">&larr;</button>
                        <button class="btn btn-sm btn-secondary" onclick="changeMonth(1)">&rarr;</button>
                        <button class="btn btn-sm btn-secondary" onclick="goToToday()">Today</button>
                    </div>
                </div>
                <button class="btn btn-primary" onclick="showEventForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Event
                </button>
            </div>
            
            <div class="grid-2">
                <div>
                    <div class="calendar-grid" style="margin-bottom: 8px;">
                        ${dayNames.map(d => `<div class="calendar-day-header">${d}</div>`).join('')}
                    </div>
                    <div class="calendar-grid">
                        ${daysHtml}
                    </div>
                </div>
                
                <div>
                    <h3 class="section-title" style="margin-bottom: 16px;">Upcoming Events</h3>
                    ${upcoming.length > 0 ? upcoming.map(e => `
                        <div class="list-item list-item-actionable">
                            <div class="list-item-info">
                                <div class="list-item-title">${escapeHtml(e.title)}</div>
                                <div class="list-item-meta">${formatDateTime(e.start_time)} ${e.location ? `&bull; ${escapeHtml(e.location)}` : ''}</div>
                            </div>
                            <div class="list-item-actions">
                                <button class="btn btn-sm btn-secondary" onclick="showEventForm(${e.id})">Edit</button>
                                <button class="btn-icon btn-danger-icon" onclick="deleteEvent(${e.id})" title="Delete" aria-label="Delete">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                </button>
                            </div>
                        </div>
                    `).join('') : '<div class="empty-state">No upcoming events</div>'}
                </div>
            </div>
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function getEventColor(category) {
    const colors = {
        personal: '#8b5cf6', work: '#3b82f6', health: '#22c55e',
        finance: '#f59e0b', learning: '#14b8a6', default: '#64748b'
    };
    return colors[category] || colors.default;
}

function changeMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendar();
}

function goToToday() {
    currentCalendarDate = new Date();
    renderCalendar();
}

function showDayEvents(year, month, day) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayEvents = calendarEvents.filter(e => {
        const d = new Date(e.start_time);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    });

    let bodyHtml;
    if (dayEvents.length > 0) {
        bodyHtml = dayEvents.map(e => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--c-border);">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600;">${escapeHtml(e.title)}</div>
                    <div style="font-size: 0.8125rem; color: var(--c-text2);">${formatDateTime(e.start_time)}${e.category ? ' &bull; ' + escapeHtml(e.category) : ''}</div>
                </div>
                <div style="display: flex; gap: 6px; flex-shrink: 0; margin-left: 12px;">
                    <button class="btn btn-sm btn-secondary" onclick="closeModal(); showEventForm(${e.id})">Edit</button>
                    <button class="btn-icon btn-danger-icon" onclick="closeModal(); deleteEvent(${e.id})" title="Delete" aria-label="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');
    } else {
        bodyHtml = '<div style="padding: 16px 0; color: var(--c-text2); text-align: center;">No events for this day</div>';
    }

    openModal(`Events — ${formatDate(dateStr)}`, `
        ${bodyHtml}
        <div style="margin-top: 16px; text-align: center;">
            <button class="btn btn-primary" onclick="closeModal(); showEventForm(null, '${dateStr}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Event
            </button>
        </div>
    `);
}

function showEventForm(id = null, dateStr = null) {
    const fetchAndShow = async () => {
        let event = null;
        if (id) {
            event = await api(`/events/${id}`);
        }
        
        const startDate = event?.start_time 
            ? new Date(event.start_time).toISOString().slice(0, 16) 
            : dateStr 
                ? `${dateStr}T09:00` 
                : new Date().toISOString().slice(0, 16);
        
        openModal(id ? 'Edit Event' : 'New Event', `
            <form id="eventForm" onsubmit="saveEvent(event, ${id || 'null'})">
                <div class="form-group">
                    <label class="form-label">Title <span class="required-mark">*</span></label>
                    <input type="text" class="form-control" name="title" value="${escapeHtml(event?.title || '')}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-control" name="description">${escapeHtml(event?.description || '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Start Time <span class="required-mark">*</span></label>
                        <input type="datetime-local" class="form-control" name="start_time" value="${startDate}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">End Time</label>
                        <input type="datetime-local" class="form-control" name="end_time" value="${event?.end_time ? new Date(event.end_time).toISOString().slice(0, 16) : ''}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Location</label>
                        <input type="text" class="form-control" name="location" value="${escapeHtml(event?.location || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <select class="form-control" name="category">
                            <option value="personal" ${event?.category === 'personal' ? 'selected' : ''}>Personal</option>
                            <option value="work" ${event?.category === 'work' ? 'selected' : ''}>Work</option>
                            <option value="health" ${event?.category === 'health' ? 'selected' : ''}>Health</option>
                            <option value="finance" ${event?.category === 'finance' ? 'selected' : ''}>Finance</option>
                            <option value="learning" ${event?.category === 'learning' ? 'selected' : ''}>Learning</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">
                        <input type="checkbox" name="is_all_day" ${event?.is_all_day ? 'checked' : ''} style="margin-right: 8px;">
                        All Day Event
                    </label>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Event</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveEvent(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        title: form.title.value,
        description: form.description.value || null,
        start_time: form.start_time.value,
        end_time: form.end_time.value || null,
        location: form.location.value || null,
        category: form.category.value,
        is_all_day: form.is_all_day.checked
    };
    
    try {
        if (id) {
            await api(`/events/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Event updated');
        } else {
            await api('/events', { method: 'POST', body: JSON.stringify(data) });
            showToast('Event created');
        }
        closeModal();
        renderCalendar();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    try {
        await api(`/events/${id}`, { method: 'DELETE' });
        showToast('Event deleted');
        renderCalendar();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== CONTACTS ====================

let contactsData = [];

async function renderContacts() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:100px;height:26px"></h2></div><div class="skeleton" style="width:120px;height:36px;border-radius:var(--r)"></div></div><div class="filters"><div class="skeleton" style="width:220px;height:38px;border-radius:var(--r)"></div><div class="skeleton" style="width:150px;height:38px;border-radius:var(--r)"></div></div><div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))"><div class="card"><div style="display:flex;align-items:center;gap:16px;margin-bottom:12px"><div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div><div><div class="skeleton" style="width:120px;height:18px;margin-bottom:4px"></div><div class="skeleton" style="width:80px;height:20px;border-radius:999px"></div></div></div><div class="skeleton" style="width:60%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:50%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:70%;height:14px;margin-bottom:12px"></div><div style="display:flex;gap:8px;margin-top:16px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div></div></div><div class="card"><div style="display:flex;align-items:center;gap:16px;margin-bottom:12px"><div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div><div><div class="skeleton" style="width:100px;height:18px;margin-bottom:4px"></div><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></div></div><div class="skeleton" style="width:55%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:45%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:65%;height:14px;margin-bottom:12px"></div><div style="display:flex;gap:8px;margin-top:16px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div></div></div><div class="card"><div style="display:flex;align-items:center;gap:16px;margin-bottom:12px"><div class="skeleton" style="width:48px;height:48px;border-radius:50%"></div><div><div class="skeleton" style="width:140px;height:18px;margin-bottom:4px"></div><div class="skeleton" style="width:50px;height:20px;border-radius:999px"></div></div></div><div class="skeleton" style="width:50%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:60%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:75%;height:14px;margin-bottom:12px"></div><div style="display:flex;gap:8px;margin-top:16px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div></div></div></div>`;
    
    try {
        contactsData = await api('/contacts');
        
        contentArea.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">Contacts</h2>
                <button class="btn btn-primary" onclick="showContactForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Contact
                </button>
            </div>
            
            <div class="filters">
                <div class="section-search-container">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="text" class="section-search-input" id="contactSearch" placeholder="Search contacts..." oninput="filterContacts()">
                </div>
                <select class="form-control" id="contactCategory" aria-label="Filter category" style="width: auto; border-radius: var(--r-full); padding: 6px 14px; background: var(--c-surface); border: 1px solid var(--c-border);" onchange="filterContacts()">
                    <option value="">All Categories</option>
                    <option value="family">Family</option>
                    <option value="friend">Friend</option>
                    <option value="work">Work</option>
                    <option value="other">Other</option>
                </select>
            </div>
            
            <div id="contactsList">
                ${renderContactsList(contactsData)}
            </div>
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function renderContactsList(contacts) {
    if (contacts.length === 0) {
        return `<div class="empty-state">
            <div class="empty-state-illustration">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            </div>
            <h3>No contacts yet</h3>
            <p>Keep the people who matter in one place — add your first contact.</p>
            <button class="btn btn-primary" onclick="showContactForm()">Add Contact</button>
        </div>`;
    }
    
    return `
        <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
            ${contacts.map(c => `
                <div class="card">
                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px;">
                        <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--c-primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; font-weight: 600;">
                            ${c.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div style="font-weight: 600; font-size: 1.125rem;">${escapeHtml(c.name)}</div>
                            ${c.category ? `<span class="badge badge-secondary badge-dot">${c.category}</span>` : ''}
                        </div>
                    </div>
                    ${c.email ? `<div style="font-size: 0.875rem; color: var(--c-text2); margin-bottom: 4px;"><a href="mailto:${escapeHtml(c.email)}" style="color: var(--c-primary); text-decoration: none;">📧 ${escapeHtml(c.email)}</a></div>` : ''}
                    ${c.phone ? `<div style="font-size: 0.875rem; color: var(--c-text2); margin-bottom: 4px;"><a href="tel:${escapeHtml(c.phone)}" style="color: var(--c-primary); text-decoration: none;">📱 ${escapeHtml(c.phone)}</a></div>` : ''}
                    ${c.company ? `<div style="font-size: 0.875rem; color: var(--c-text2); margin-bottom: 4px;">🏢 ${escapeHtml(c.company)}${c.job_title ? ', ' + escapeHtml(c.job_title) : ''}</div>` : ''}
                    ${c.birthday ? `<div style="font-size: 0.875rem; color: var(--c-text2); margin-bottom: 4px;">🎂 ${formatDate(c.birthday)}</div>` : ''}
                    ${c.notes ? `<div style="font-size: 0.875rem; color: var(--c-text2); margin-top: 8px;">${escapeHtml(c.notes)}</div>` : ''}
                    <div style="display: flex; gap: 8px; margin-top: 16px;">
                        <button class="btn btn-sm btn-secondary" onclick="showContactForm(${c.id})">Edit</button>
                        <button class="btn-icon btn-danger-icon" onclick="deleteContact(${c.id})" title="Delete" aria-label="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function filterContacts() {
    const search = document.getElementById('contactSearch').value.toLowerCase();
    const category = document.getElementById('contactCategory').value;
    
    let filtered = contactsData;
    
    if (search) {
        filtered = filtered.filter(c => 
            c.name.toLowerCase().includes(search) ||
            (c.email && c.email.toLowerCase().includes(search)) ||
            (c.phone && c.phone.includes(search))
        );
    }
    
    if (category) {
        filtered = filtered.filter(c => c.category === category);
    }
    
    document.getElementById('contactsList').innerHTML = renderContactsList(filtered);
}

function showContactForm(id = null) {
    const fetchAndShow = async () => {
        let contact = null;
        if (id) {
            contact = await api(`/contacts/${id}`);
        }
        
        openModal(id ? 'Edit Contact' : 'Add Contact', `
            <form id="contactForm" onsubmit="saveContact(event, ${id || 'null'})">
                <div class="form-group">
                    <label class="form-label" for="contact_name">Name <span class="required-mark">*</span></label>
                    <input type="text" class="form-control" id="contact_name" name="name" value="${escapeHtml(contact?.name || '')}" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="contact_email">Email</label>
                        <input type="email" class="form-control" id="contact_email" name="email" value="${escapeHtml(contact?.email || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="contact_phone">Phone</label>
                        <input type="tel" class="form-control" id="contact_phone" name="phone" value="${escapeHtml(contact?.phone || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="contact_company">Company</label>
                        <input type="text" class="form-control" id="contact_company" name="company" value="${escapeHtml(contact?.company || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="contact_job_title">Job Title</label>
                        <input type="text" class="form-control" id="contact_job_title" name="job_title" value="${escapeHtml(contact?.job_title || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="contact_category">Category</label>
                        <select class="form-control" id="contact_category" name="category">
                            <option value="">Select...</option>
                            <option value="family" ${contact?.category === 'family' ? 'selected' : ''}>Family</option>
                            <option value="friend" ${contact?.category === 'friend' ? 'selected' : ''}>Friend</option>
                            <option value="work" ${contact?.category === 'work' ? 'selected' : ''}>Work</option>
                            <option value="other" ${contact?.category === 'other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="contact_birthday">Birthday</label>
                        <input type="date" class="form-control" id="contact_birthday" name="birthday" value="${contact?.birthday || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label" for="contact_address">Address</label>
                    <textarea class="form-control" id="contact_address" name="address">${escapeHtml(contact?.address || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label" for="contact_notes">Notes</label>
                    <textarea class="form-control" id="contact_notes" name="notes">${escapeHtml(contact?.notes || '')}</textarea>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveContact(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        name: form.name.value,
        email: form.email.value || null,
        phone: form.phone.value || null,
        company: form.company.value || null,
        job_title: form.job_title.value || null,
        category: form.category.value || null,
        birthday: form.birthday.value || null,
        address: form.address.value || null,
        notes: form.notes.value || null
    };
    
    try {
        if (id) {
            await api(`/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Contact updated');
        } else {
            await api('/contacts', { method: 'POST', body: JSON.stringify(data) });
            showToast('Contact added');
        }
        closeModal();
        renderContacts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteContact(id) {
    if (!confirm('Delete this contact?')) return;
    try {
        await api(`/contacts/${id}`, { method: 'DELETE' });
        showToast('Contact deleted');
        renderContacts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== DOCUMENTS ====================

// ==================== DRIVE (formerly Documents) ====================

let currentFolder = { id: null, path: [] }; // path: [{id, name}, ...]
let driveViewMode = 'grid'; // 'grid' | 'list'
let driveSearchQuery = '';

function navigateToFolder(folder) {
    driveSearchQuery = '';
    currentFolder = { id: folder.id, path: folder.path || [{ id: folder.id, name: folder.name }] };
    renderDrive();
}

function navigateDriveUp() {
    driveSearchQuery = '';
    if (currentFolder.path.length <= 1) {
        currentFolder = { id: null, path: [] };
    } else {
        const newPath = currentFolder.path.slice(0, -1);
        const parent = newPath[newPath.length - 1];
        currentFolder = { id: parent.id, path: newPath };
    }
    renderDrive();
}

function navigateDriveRoot() {
    driveSearchQuery = '';
    currentFolder = { id: null, path: [] };
    renderDrive();
}

function navigateDriveToCrumb(index) {
    driveSearchQuery = '';
    if (index < 0) { navigateDriveRoot(); return; }
    const crumb = currentFolder.path[index];
    currentFolder = { id: crumb.id, path: currentFolder.path.slice(0, index + 1) };
    renderDrive();
}

function filterDriveLive(q) {
    driveSearchQuery = q.toLowerCase();
    
    // Filter grid items
    const gridItems = document.querySelectorAll('.card-grid .drive-item');
    gridItems.forEach(item => {
        const name = item.querySelector('.drive-item-name')?.textContent?.toLowerCase() || '';
        const matches = name.includes(driveSearchQuery);
        item.style.display = matches ? '' : 'none';
    });

    // Filter table rows
    const listRows = document.querySelectorAll('.drive-table tbody tr');
    listRows.forEach(row => {
        const name = row.querySelector('.drive-row-name')?.textContent?.toLowerCase() || '';
        const matches = name.includes(driveSearchQuery);
        row.style.display = matches ? '' : 'none';
    });
}

async function renderDrive() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:80px;height:26px"></h2></div><div style="display:flex;gap:8px"><div class="skeleton" style="width:110px;height:36px;border-radius:var(--r)"></div><div class="skeleton" style="width:90px;height:36px;border-radius:var(--r)"></div></div></div><div class="skeleton" style="width:60%;height:18px;margin-bottom:20px"></div><div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px"><div class="card" style="padding:16px;text-align:center"><div class="skeleton" style="width:48px;height:48px;margin:0 auto 8px"></div><div class="skeleton" style="width:80%;height:14px;margin:0 auto 4px"></div><div class="skeleton" style="width:50%;height:12px;margin:0 auto"></div></div>${'<div class="card" style="padding:16px;text-align:center"><div class="skeleton" style="width:48px;height:48px;margin:0 auto 8px"></div><div class="skeleton" style="width:80%;height:14px;margin:0 auto 4px"></div><div class="skeleton" style="width:50%;height:12px;margin:0 auto"></div></div>'.repeat(5)}</div>`;

    try {
        const folderId = currentFolder.id || 'root';
        const [folders, docs] = await Promise.all([
            api(`/folders?parent_id=${folderId}`),
            api(`/documents?folder_id=${folderId}`)
        ]);

        let filteredFolders = folders;
        let filteredDocs = docs;
        if (driveSearchQuery) {
            filteredFolders = folders.filter(f => f.name.toLowerCase().includes(driveSearchQuery));
            filteredDocs = docs.filter(d => d.original_name.toLowerCase().includes(driveSearchQuery));
        }

        const breadcrumbs = `<nav class="drive-breadcrumb" aria-label="Drive path">
            <a href="#" onclick="event.preventDefault();navigateDriveRoot()" class="crumb ${currentFolder.path.length === 0 ? 'crumb-current' : ''}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                My Drive
            </a>
            ${currentFolder.path.map((c, i) => `
                <span class="crumb-sep">/</span>
                <a href="#" onclick="event.preventDefault();navigateDriveToCrumb(${i})" class="crumb ${i === currentFolder.path.length - 1 ? 'crumb-current' : ''}">${escapeHtml(c.name)}</a>
            `).join('')}
        </nav>`;

        const totalSize = filteredDocs.reduce((s, d) => s + (d.file_size || 0), 0);
        const stats = (filteredFolders.length || filteredDocs.length) ? `<div class="drive-stats">${filteredFolders.length} folder${filteredFolders.length !== 1 ? 's' : ''} &middot; ${filteredDocs.length} file${filteredDocs.length !== 1 ? 's' : ''}${filteredDocs.length ? ` &middot; ${formatFileSize(totalSize)}` : ''}</div>` : '';

        const viewToggle = `<div class="view-toggle" role="tablist">
            <button class="view-toggle-btn ${driveViewMode === 'grid' ? 'active' : ''}" onclick="setDriveView('grid')" title="Grid view" aria-label="Grid view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            </button>
            <button class="view-toggle-btn ${driveViewMode === 'list' ? 'active' : ''}" onclick="setDriveView('list')" title="List view" aria-label="List view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
        </div>`;

        contentArea.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">Drive</h2>
                <div style="display:flex;gap:8px;align-items:center">
                    ${viewToggle}
                    <button class="btn btn-secondary" onclick="showNewFolderForm()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                        New Folder
                    </button>
                    <button class="btn btn-primary" onclick="showUploadForm()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Upload
                    </button>
                </div>
            </div>

            ${breadcrumbs}
            
            <div class="filters">
                <div class="section-search-container">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="text" class="section-search-input" id="driveSearchInput" placeholder="Filter files & folders..." oninput="filterDriveLive(this.value)" value="${escapeHtml(driveSearchQuery)}">
                </div>
                ${stats}
            </div>

            ${(filteredFolders.length === 0 && filteredDocs.length === 0) ? renderDriveEmpty() : (driveViewMode === 'grid' ? renderDriveGrid(filteredFolders, filteredDocs) : renderDriveList(filteredFolders, filteredDocs))}
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function setDriveView(mode) {
    driveViewMode = mode;
    renderDrive();
}

function renderDriveEmpty() {
    return `<div class="empty-state">
        <div class="empty-state-illustration">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <h3>This folder is empty</h3>
        <p>Drop in a file or create a folder to get started.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:16px">
            <button class="btn btn-secondary" onclick="showNewFolderForm()">New Folder</button>
            <button class="btn btn-primary" onclick="showUploadForm()">Upload File</button>
        </div>
    </div>`;
}

function renderDriveGrid(folders, docs) {
    return `<div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
        ${folders.map(f => `
            <div class="drive-item drive-folder" onclick='openFolder(${f.id})' role="button" tabindex="0">
                <div class="drive-item-icon folder-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
                </div>
                <div class="drive-item-name">${escapeHtml(f.name)}</div>
                <div class="drive-item-meta">Folder</div>
                <div class="drive-item-actions" onclick="event.stopPropagation()">
                    <button class="btn-icon" onclick='event.stopPropagation();renameFolder(${f.id}, ${JSON.stringify(f.name)})' title="Rename" aria-label="Rename">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon btn-danger-icon" onclick='event.stopPropagation();deleteFolder(${f.id}, ${JSON.stringify(f.name)})' title="Delete" aria-label="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    </button>
                </div>
            </div>
        `).join('')}
        ${docs.map(d => `
            <div class="drive-item drive-file" onclick='previewFile(${JSON.stringify(d)})' role="button" tabindex="0">
                <div class="drive-item-icon file-icon">${getFileIcon(d.file_type)}</div>
                <div class="drive-item-name">${escapeHtml(d.original_name)}</div>
                <div class="drive-item-meta">${d.file_type.toUpperCase()} &middot; ${formatFileSize(d.file_size)}</div>
                <div class="drive-item-actions" onclick="event.stopPropagation()">
                    <button class="btn-icon" onclick='event.stopPropagation();previewFile(${JSON.stringify(d)})' title="Preview" aria-label="Preview">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <a href="/api/documents/${d.id}" class="btn-icon" download title="Download" aria-label="Download" onclick="event.stopPropagation()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                    <button class="btn-icon" onclick='event.stopPropagation();showDocumentEditForm(${d.id})' title="Edit" aria-label="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon btn-danger-icon" onclick='event.stopPropagation();deleteDocument(${d.id})' title="Delete" aria-label="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    </button>
                </div>
            </div>
        `).join('')}
    </div>`;
}

function renderDriveList(folders, docs) {
    const rows = [
        ...folders.map(f => `
            <tr class="drive-row drive-row-folder" onclick='openFolder(${f.id})'>
                <td><div class="drive-row-name"><span class="drive-row-icon">📁</span>${escapeHtml(f.name)}</div></td>
                <td class="drive-row-type">Folder</td>
                <td class="drive-row-meta">—</td>
                <td class="drive-row-actions" onclick="event.stopPropagation()">
                    <button class="btn-icon" onclick='event.stopPropagation();renameFolder(${f.id}, ${JSON.stringify(f.name)})' title="Rename" aria-label="Rename">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon btn-danger-icon" onclick='event.stopPropagation();deleteFolder(${f.id}, ${JSON.stringify(f.name)})' title="Delete" aria-label="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    </button>
                </td>
            </tr>
        `),
        ...docs.map(d => `
            <tr class="drive-row drive-row-file" onclick='previewFile(${JSON.stringify(d)})'>
                <td><div class="drive-row-name"><span class="drive-row-icon">${getFileIcon(d.file_type)}</span>${escapeHtml(d.original_name)}</div></td>
                <td class="drive-row-type">${(d.file_type || '').toUpperCase() || 'FILE'}</td>
                <td class="drive-row-meta">${formatFileSize(d.file_size)} &middot; ${formatDate(d.upload_date)}</td>
                <td class="drive-row-actions" onclick="event.stopPropagation()">
                    <button class="btn-icon" onclick='event.stopPropagation();previewFile(${JSON.stringify(d)})' title="Preview" aria-label="Preview">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                    <a href="/api/documents/${d.id}" class="btn-icon" download title="Download" aria-label="Download" onclick="event.stopPropagation()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                    <button class="btn-icon" onclick='event.stopPropagation();showDocumentEditForm(${d.id})' title="Edit" aria-label="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn-icon btn-danger-icon" onclick='event.stopPropagation();deleteDocument(${d.id})' title="Delete" aria-label="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    </button>
                </td>
            </tr>
        `)
    ];
    return `<div class="table-container"><table class="drive-table">
        <thead><tr><th>Name</th><th style="width:90px">Type</th><th style="width:200px">Details</th><th style="width:160px"></th></tr></thead>
        <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

async function openFolder(id) {
    try {
        const data = await api(`/folders/${id}/contents`);
        navigateToFolder({ id: data.folder.id, name: data.folder.name, path: data.folder.path });
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showNewFolderForm() {
    openModal('New Folder', `
        <form onsubmit="createFolder(event)">
            <div class="form-group">
                <label class="form-label">Folder name <span class="required-mark">*</span></label>
                <input type="text" class="form-control" name="name" required autofocus placeholder="e.g., Work, Receipts, 2026 Tax">
            </div>
            <div class="form-group">
                <label class="form-label">Location</label>
                <div style="padding:10px 12px;background:var(--c-surface2);border-radius:var(--r);font-size:.875rem;color:var(--c-text2)">
                    ${currentFolder.path.length ? currentFolder.path.map(c => escapeHtml(c.name)).join(' / ') : 'My Drive (root)'}
                </div>
            </div>
            <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:20px">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Create</button>
            </div>
        </form>
    `);
}

async function createFolder(event) {
    event.preventDefault();
    const name = event.target.name.value.trim();
    if (!name) return;
    try {
        await api('/folders', { method: 'POST', body: JSON.stringify({ name, parent_id: currentFolder.id }) });
        showToast('Folder created');
        closeModal();
        renderDrive();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function renameFolder(id, currentName) {
    const name = prompt('Rename folder:', currentName);
    if (name === null || !name.trim() || name === currentName) return;
    try {
        await api(`/folders/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
        showToast('Folder renamed');
        renderDrive();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteFolder(id, name) {
    if (!confirm(`Delete folder "${name}"? Its contents will be moved to the parent folder.`)) return;
    try {
        await api(`/folders/${id}`, { method: 'DELETE' });
        showToast('Folder deleted');
        renderDrive();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function previewFile(doc) {
    const url = `/api/documents/${doc.id}/preview`;
    const t = (doc.file_type || '').toLowerCase();
    const name = escapeHtml(doc.original_name);

    let body = '';
    if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(doc.original_name)) {
        body = `<div class="preview-image-container"><img class="preview-image" src="${url}" alt="${name}"></div>`;
    } else if (t === 'application/pdf' || /\.pdf$/i.test(doc.original_name)) {
        body = `<iframe class="preview-modal-frame" src="${url}" title="${name}"></iframe>`;
    } else if (t.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(doc.original_name)) {
        body = `<video src="${url}" controls style="width:100%;max-height:75vh;display:block;border-radius:var(--r);background:#000"></video>`;
    } else if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(doc.original_name)) {
        body = `<div style="text-align:center;padding:24px;background:var(--c-surface2);border-radius:var(--r)"><div style="font-size:3rem;margin-bottom:16px">🎵</div><div style="font-weight:500;margin-bottom:16px">${name}</div><audio src="${url}" controls style="width:100%"></audio></div>`;
    } else if (t.startsWith('text/') || /\.(txt|md|markdown|csv|log|json|xml|html?|css|js|ts|py|java|c|cpp|h|hpp|rs|go|rb|php|sh|bat|yaml|yml|ini|toml|env|sql)$/i.test(doc.original_name)) {
        fetch(url).then(r => r.text()).then(text => {
            const safe = text.length > 500000 ? text.slice(0, 500000) + '\n\n... (truncated, file too large to preview fully)' : text;
            document.getElementById('previewContent').innerHTML = `<pre style="background:var(--c-surface2);padding:16px;border-radius:var(--r);overflow:auto;max-height:75vh;font-family:var(--font-mono,monospace);font-size:.8125rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtml(safe)}</pre>`;
        }).catch(err => {
            document.getElementById('previewContent').innerHTML = `<div class="empty-state"><p>Could not load file contents: ${escapeHtml(err.message)}</p></div>`;
        });
        body = `<div id="previewContent"><div class="empty-state" style="padding:40px"><div class="skeleton" style="width:60%;height:14px;margin:0 auto 8px"></div><div class="skeleton" style="width:80%;height:14px;margin:0 auto 8px"></div><div class="skeleton" style="width:40%;height:14px;margin:0 auto"></div></div></div>`;
    } else {
        body = `<div class="empty-state" style="padding:48px 24px">
            <div class="empty-state-illustration">
                <div style="font-size:3.5rem">${getFileIcon(doc.file_type)}</div>
            </div>
            <h3>Preview not available</h3>
            <p>This file type (${escapeHtml(doc.file_type || 'unknown')}) can't be previewed in the browser.</p>
            <a href="${url}" download class="btn btn-primary">Download File</a>
        </div>`;
    }

    openModal(`Preview: ${name}`, `
        ${body}
        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid var(--c-border2)">
            <a href="${url}" download class="btn btn-secondary">Download</a>
            <button type="button" class="btn btn-primary" onclick="closeModal()">Close</button>
        </div>
    `);
}

function showUploadForm() {
    const locationLabel = currentFolder.path.length ? currentFolder.path.map(c => escapeHtml(c.name)).join(' / ') : 'My Drive (root)';
    openModal('Upload File', `
        <form id="uploadForm" onsubmit="uploadDocument(event)" enctype="multipart/form-data">
            <div class="form-group">
                <label class="form-label">File <span class="required-mark">*</span></label>
                <input type="file" class="form-control" name="file" required style="padding: 8px;">
            </div>
            <div class="form-group">
                <label class="form-label">Upload to</label>
                <div style="padding:10px 12px;background:var(--c-surface2);border-radius:var(--r);font-size:.875rem;color:var(--c-text2)">${locationLabel}</div>
            </div>
            <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-control" name="description" rows="2"></textarea>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">Category</label>
                    <select class="form-control" name="category">
                        <option value="personal">Personal</option>
                        <option value="work">Work</option>
                        <option value="health">Health</option>
                        <option value="finance">Finance</option>
                        <option value="education">Education</option>
                        <option value="other" selected>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Tags</label>
                    <input type="text" class="form-control" name="tags" placeholder="Comma separated">
                </div>
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px;">
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Upload</button>
            </div>
        </form>
    `);
}

async function uploadDocument(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData();
    formData.append('file', form.file.files[0]);
    formData.append('description', form.description.value);
    formData.append('category', form.category.value);
    formData.append('tags', form.tags.value);
    formData.append('folder_id', currentFolder.id || '');

    try {
        const response = await fetch('/api/documents', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
        }

        showToast('File uploaded');
        closeModal();
        renderDrive();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteDocument(id) {
    if (!confirm('Delete this file?')) return;
    try {
        await api(`/documents/${id}`, { method: 'DELETE' });
        showToast('File deleted');
        renderDrive();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function showDocumentEditForm(id) {
    try {
        const doc = await api(`/documents/${id}`);
        const allFolders = await api('/folders?parent_id=root');
        const allFoldersFlat = await api('/folders');
        const folderOptions = `<option value="">My Drive (root)</option>${allFoldersFlat.map(f => {
            const depth = (f.path || []).length - 1;
            const indent = depth > 0 ? '&nbsp;'.repeat(depth * 3) + '↳ ' : '';
            return `<option value="${f.id}" ${doc.folder_id == f.id ? 'selected' : ''}>${indent}${escapeHtml(f.name)}</option>`;
        }).join('')}`;

        openModal('Edit File', `
            <form id="docEditForm" onsubmit="saveDocumentEdit(event, ${id})">
                <div class="form-group">
                    <label class="form-label">Name</label>
                    <input type="text" class="form-control" name="original_name" value="${escapeHtml(doc.original_name)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Location</label>
                    <select class="form-control" name="folder_id">${folderOptions}</select>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-control" name="description" rows="2">${escapeHtml(doc.description || '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <select class="form-control" name="category">
                            <option value="personal" ${doc.category === 'personal' ? 'selected' : ''}>Personal</option>
                            <option value="work" ${doc.category === 'work' ? 'selected' : ''}>Work</option>
                            <option value="health" ${doc.category === 'health' ? 'selected' : ''}>Health</option>
                            <option value="finance" ${doc.category === 'finance' ? 'selected' : ''}>Finance</option>
                            <option value="education" ${doc.category === 'education' ? 'selected' : ''}>Education</option>
                            <option value="other" ${(doc.category || 'other') === 'other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tags</label>
                        <input type="text" class="form-control" name="tags" value="${escapeHtml(doc.tags || '')}" placeholder="Comma separated">
                    </div>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function saveDocumentEdit(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        original_name: form.original_name.value.trim(),
        folder_id: form.folder_id.value || null,
        description: form.description.value,
        category: form.category.value,
        tags: form.tags.value
    };
    try {
        await api(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('File updated');
        closeModal();
        renderDrive();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== JOURNAL ====================

let journalSearchQuery = '';

function filterJournalLive(q) {
    journalSearchQuery = q.toLowerCase();
    const cards = document.querySelectorAll('.card-grid .card');
    cards.forEach(card => {
        const title = card.querySelector('h3')?.textContent?.toLowerCase() || '';
        const content = card.querySelector('div[style*="line-height: 1.6;"]')?.textContent?.toLowerCase() || '';
        const tags = card.querySelector('div[style*="margin-bottom: 12px;"]')?.textContent?.toLowerCase() || '';
        const matches = title.includes(journalSearchQuery) || content.includes(journalSearchQuery) || tags.includes(journalSearchQuery);
        card.style.display = matches ? '' : 'none';
    });
}

function renderJournalMoodAnalytics(entries) {
    const dates = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dates.push(`${yyyy}-${mm}-${dd}`);
    }

    const moodMap = {};
    const tagCounts = {};
    entries.forEach(e => {
        if (e.date) {
            const entryDate = e.date.split('T')[0];
            moodMap[entryDate] = { mood: e.mood, title: e.title, id: e.id };
        }
        if (e.tags) {
            e.tags.split(',').forEach(tag => {
                const trimmed = tag.trim().toLowerCase();
                if (trimmed) {
                    tagCounts[trimmed] = (tagCounts[trimmed] || 0) + 1;
                }
            });
        }
    });

    const cellsHtml = dates.map(date => {
        const entry = moodMap[date];
        const mood = entry ? entry.mood : 'empty';
        const displayDate = new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const tooltipText = entry 
            ? `${displayDate}: ${entry.mood.toUpperCase()}${entry.title ? ` - ${entry.title}` : ''}`
            : `${displayDate}: No entry`;
        
        const onClickAttr = entry ? `onclick="scrollToJournalCard(${entry.id})"` : '';
        const cursorStyle = entry ? 'cursor: pointer;' : 'cursor: default;';
        
        return `
            <div class="mood-cell ${mood}" style="${cursorStyle}" ${onClickAttr}>
                <div class="mood-tooltip">${escapeHtml(tooltipText)}</div>
            </div>
        `;
    }).join('');

    const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    const tagsHtml = topTags.map(([tag, count]) => `
        <span class="tag" style="cursor: pointer;" onclick="filterJournalByTag('${escapeHtml(tag)}')">
            #${escapeHtml(tag)} <strong style="margin-left: 4px; color: var(--c-primary);">${count}</strong>
        </span>
    `).join('');

    return `
        <details class="journal-analytics" open style="margin-bottom: 24px;">
            <summary style="font-weight: 600; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: space-between; outline: none;">
                <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9375rem; color: var(--c-text);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>
                    Mood Heatmap & Journal Analytics (Last 30 Days)
                </div>
                <span style="font-size: 0.75rem; color: var(--c-text3); font-weight: normal;">[Click to collapse/expand]</span>
            </summary>
            
            <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 16px;">
                <div class="mood-heatmap-container">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <span class="mood-heatmap-title">Daily Mood Log (Older → Newer)</span>
                        <div style="display: flex; gap: 8px; font-size: 0.6875rem; align-items: center;">
                            <span style="color: var(--c-text3);">Key:</span>
                            <span style="display:inline-block; width:10px; height:10px; border-radius:3px; background:linear-gradient(135deg, #a855f7, #7c3aed);"></span> Amazing
                            <span style="display:inline-block; width:10px; height:10px; border-radius:3px; background:linear-gradient(135deg, #10b981, #059669);"></span> Good
                            <span style="display:inline-block; width:10px; height:10px; border-radius:3px; background:linear-gradient(135deg, #fbbc05, #d97706);"></span> Okay
                            <span style="display:inline-block; width:10px; height:10px; border-radius:3px; background:linear-gradient(135deg, #f97316, #ea580c);"></span> Bad
                            <span style="display:inline-block; width:10px; height:10px; border-radius:3px; background:linear-gradient(135deg, #f43f5e, #e11d48);"></span> Terrible
                        </div>
                    </div>
                    <div class="mood-heatmap-grid">
                        ${cellsHtml}
                    </div>
                </div>
                
                ${topTags.length > 0 ? `
                    <div>
                        <div class="mood-heatmap-title" style="margin-bottom: 8px;">Most Frequent Tags</div>
                        <div class="mood-breakdown-tags">
                            ${tagsHtml}
                        </div>
                    </div>
                ` : ''}
            </div>
        </details>
    `;
}

function scrollToJournalCard(id) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
        const btn = card.querySelector(`button[onclick*="showJournalForm(${id})"]`);
        if (btn) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.borderColor = 'var(--c-primary)';
            card.style.boxShadow = 'var(--sh-lg)';
            setTimeout(() => {
                card.style.borderColor = '';
                card.style.boxShadow = '';
            }, 3000);
            break;
        }
    }
}

function filterJournalByTag(tag) {
    const input = document.getElementById('journalSearchInput');
    if (input) {
        if (input.value === tag) {
            input.value = '';
            filterJournalLive('');
        } else {
            input.value = tag;
            filterJournalLive(tag);
        }
    }
}

window.scrollToJournalCard = scrollToJournalCard;
window.filterJournalByTag = filterJournalByTag;

async function renderJournal() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:90px;height:26px"></h2></div><div class="skeleton" style="width:110px;height:36px;border-radius:var(--r)"></div></div><div class="card-grid" style="grid-template-columns:repeat(auto-fill,minmax(400px,1fr))"><div class="card" style="position:relative"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div class="skeleton" style="width:100px;height:14px"></div><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></div><div class="skeleton" style="width:75%;height:20px;margin-bottom:12px"></div><div class="skeleton" style="width:100%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:100%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:60%;height:14px;margin-bottom:16px"></div><div style="display:flex;gap:8px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div></div></div><div class="card" style="position:relative"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div class="skeleton" style="width:100px;height:14px"></div><div class="skeleton" style="width:60px;height:20px;border-radius:999px"></div></div><div class="skeleton" style="width:65%;height:20px;margin-bottom:12px"></div><div class="skeleton" style="width:100%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:100%;height:14px;margin-bottom:4px"></div><div class="skeleton" style="width:50%;height:14px;margin-bottom:16px"></div><div style="display:flex;gap:8px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div></div></div></div>`;
    
    try {
        const entries = await api('/journal');
        let filtered = entries;
        if (journalSearchQuery) {
            filtered = entries.filter(e => 
                (e.title && e.title.toLowerCase().includes(journalSearchQuery)) ||
                (e.content && e.content.toLowerCase().includes(journalSearchQuery)) ||
                (e.tags && e.tags.toLowerCase().includes(journalSearchQuery))
            );
        }
        
        contentArea.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">Journal</h2>
                <button class="btn btn-primary" onclick="showJournalForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    New Entry
                </button>
            </div>
            
            <div class="filters">
                <div class="section-search-container">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input type="text" class="section-search-input" id="journalSearchInput" placeholder="Filter journal..." oninput="filterJournalLive(this.value)" value="${escapeHtml(journalSearchQuery)}">
                </div>
            </div>
            
            ${renderJournalMoodAnalytics(entries)}
            
            ${filtered.length > 0 ? `
                <div class="card-grid" style="grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));">
                    ${filtered.map(e => `
                        <div class="card" style="position: relative;">
                            <span onclick="toggleJournalFavorite(${e.id}, ${!e.is_favorite})" style="position: absolute; top: 16px; right: 16px; color: ${e.is_favorite ? 'var(--c-warning)' : 'var(--c-text3)'}; font-size: 1.25rem; cursor: pointer; user-select: none;">${e.is_favorite ? '★' : '☆'}</span>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <span style="font-size: 0.875rem; color: var(--c-text2);">${formatDate(e.date)}</span>
                                ${e.mood ? `<span class="badge badge-${e.mood === 'amazing' || e.mood === 'good' ? 'success' : e.mood === 'okay' ? 'warning' : 'danger'} badge-dot">${e.mood}</span>` : ''}
                            </div>
                            ${e.title ? `<h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 12px;">${escapeHtml(e.title)}</h3>` : ''}
                            <div style="color: var(--c-text2); line-height: 1.6; white-space: pre-wrap; margin-bottom: 16px;">${escapeHtml(e.content)}</div>
                            ${e.tags ? `<div style="margin-bottom: 12px;">${e.tags.split(',').map(t => `<span class="badge badge-secondary badge-dot" style="margin-right: 4px;">${escapeHtml(t.trim())}</span>`).join('')}</div>` : ''}
                            <div style="display: flex; gap: 8px;">
                                <button class="btn btn-sm btn-secondary" onclick="showJournalForm(${e.id})">Edit</button>
                                <button class="btn-icon btn-danger-icon" onclick="deleteJournalEntry(${e.id})" title="Delete" aria-label="Delete">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `<div class="empty-state">
                <div class="empty-state-illustration">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </div>
                <h3>No journal entries</h3>
                <p>Capture your thoughts, feelings and reflections one day at a time.</p>
                <button class="btn btn-primary" onclick="showJournalForm()">Write Entry</button>
            </div>`}
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function showJournalForm(id = null) {
    const fetchAndShow = async () => {
        let entry = null;
        if (id) {
            entry = await api(`/journal/${id}`);
        }
        
        openModal(id ? 'Edit Entry' : 'New Journal Entry', `
            <form id="journalForm" onsubmit="saveJournalEntry(event, ${id || 'null'})">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Date <span class="required-mark">*</span></label>
                        <input type="date" class="form-control" name="date" value="${entry?.date || new Date().toISOString().split('T')[0]}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mood</label>
                        <select class="form-control" name="mood">
                            <option value="">Select...</option>
                            <option value="amazing" ${entry?.mood === 'amazing' ? 'selected' : ''}>Amazing</option>
                            <option value="good" ${entry?.mood === 'good' ? 'selected' : ''}>Good</option>
                            <option value="okay" ${entry?.mood === 'okay' ? 'selected' : ''}>Okay</option>
                            <option value="bad" ${entry?.mood === 'bad' ? 'selected' : ''}>Bad</option>
                            <option value="terrible" ${entry?.mood === 'terrible' ? 'selected' : ''}>Terrible</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Title</label>
                    <input type="text" class="form-control" name="title" value="${escapeHtml(entry?.title || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">Content <span class="required-mark">*</span></label>
                    <textarea class="form-control" name="content" rows="8" required>${escapeHtml(entry?.content || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Tags (comma separated)</label>
                    <input type="text" class="form-control" name="tags" value="${escapeHtml(entry?.tags || '')}" placeholder="gratitude, reflection, ideas">
                </div>
                <div class="form-group">
                    <label class="form-label">
                        <input type="checkbox" name="is_favorite" ${entry?.is_favorite ? 'checked' : ''} style="margin-right: 8px;">
                        Mark as favorite
                    </label>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Entry</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveJournalEntry(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        date: form.date.value,
        mood: form.mood.value || null,
        title: form.title.value || null,
        content: form.content.value,
        tags: form.tags.value || null,
        is_favorite: form.is_favorite.checked
    };
    
    try {
        if (id) {
            await api(`/journal/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Entry updated');
        } else {
            await api('/journal', { method: 'POST', body: JSON.stringify(data) });
            showToast('Entry saved');
        }
        closeModal();
        renderJournal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteJournalEntry(id) {
    if (!confirm('Delete this entry?')) return;
    try {
        await api(`/journal/${id}`, { method: 'DELETE' });
        showToast('Entry deleted');
        renderJournal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function toggleJournalFavorite(id, isFavorite) {
    try {
        await api(`/journal/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_favorite: isFavorite })
        });
        showToast(isFavorite ? 'Added to favorites' : 'Removed from favorites');
        renderJournal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== GOALS ====================

let goalFilter = '';

function filterGoal(status) {
    goalFilter = status;
    renderGoals();
}

async function renderGoals() {
    contentArea.innerHTML = `<div class="section-header"><h2 class="section-title"><div class="skeleton" style="width:80px;height:26px"></h2></div><div class="skeleton" style="width:100px;height:36px;border-radius:var(--r)"></div></div><div class="card-grid"><div class="card" style="border-left:4px solid var(--c-primary)"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><div class="skeleton" style="width:70px;height:22px;border-radius:999px"></div><div class="skeleton" style="width:60px;height:22px;border-radius:999px"></div></div><div class="skeleton" style="width:80%;height:20px;margin-bottom:8px"></div><div class="skeleton" style="width:60%;height:14px;margin-bottom:16px"></div><div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><div class="skeleton" style="width:60px;height:14px"></div><div class="skeleton" style="width:40px;height:14px"></div></div><div class="progress-bar"><div class="skeleton" style="width:50%;height:8px;border-radius:999px"></div></div></div><div class="skeleton" style="width:120px;height:14px"></div><div style="display:flex;gap:8px;margin-top:16px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></div><div class="card" style="border-left:4px solid var(--c-primary)"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><div class="skeleton" style="width:80px;height:22px;border-radius:999px"></div><div class="skeleton" style="width:70px;height:22px;border-radius:999px"></div></div><div class="skeleton" style="width:70%;height:20px;margin-bottom:8px"></div><div class="skeleton" style="width:50%;height:14px;margin-bottom:16px"></div><div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><div class="skeleton" style="width:60px;height:14px"></div><div class="skeleton" style="width:40px;height:14px"></div></div><div class="progress-bar"><div class="skeleton" style="width:70%;height:8px;border-radius:999px"></div></div></div><div class="skeleton" style="width:130px;height:14px"></div><div style="display:flex;gap:8px;margin-top:16px"><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:60px;height:28px;border-radius:var(--r)"></div><div class="skeleton" style="width:50px;height:28px;border-radius:var(--r)"></div></div></div></div>`;
    
    try {
        const goals = await api('/goals');
        
        const filtered = goalFilter ? goals.filter(g => g.status === goalFilter) : goals;
        
        contentArea.innerHTML = `
            <div class="section-header">
                <h2 class="section-title">Goals</h2>
                <button class="btn btn-primary" onclick="showGoalForm()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Goal
                </button>
            </div>
            
            <div class="filters">
                <button class="btn btn-sm ${!goalFilter ? 'btn-primary' : 'btn-secondary'}" onclick="filterGoal('')">All</button>
                <button class="btn btn-sm ${goalFilter === 'active' ? 'btn-primary' : 'btn-secondary'}" onclick="filterGoal('active')">Active</button>
                <button class="btn btn-sm ${goalFilter === 'completed' ? 'btn-primary' : 'btn-secondary'}" onclick="filterGoal('completed')">Completed</button>
                <button class="btn btn-sm ${goalFilter === 'archived' ? 'btn-primary' : 'btn-secondary'}" onclick="filterGoal('archived')">Archived</button>
            </div>
            
            ${filtered.length > 0 ? `
                <div class="card-grid">
                    ${filtered.map(g => `
                        <div class="card" style="border-left: 4px solid var(--c-primary);">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                                <span class="badge badge-${g.status === 'completed' ? 'success' : 'info'} badge-dot">${g.status}</span>
                                <span class="badge badge-secondary badge-dot">${g.category || 'general'}</span>
                            </div>
                            <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 8px;">${escapeHtml(g.title)}</h3>
                            ${g.description ? `<p style="color: var(--c-text2); margin-bottom: 16px;">${escapeHtml(g.description)}</p>` : ''}
                            <div style="margin-bottom: 12px;">
                                <div style="display: flex; justify-content: space-between; font-size: 0.875rem; margin-bottom: 4px;">
                                    <span>Progress</span>
                                    <span>${g.progress}%</span>
                                </div>
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${g.progress}%"></div>
                                </div>
                            </div>
                            ${g.target_date ? `<p style="font-size: 0.875rem; color: var(--c-text2);">Target: ${formatDate(g.target_date)}</p>` : ''}
                            <div style="display: flex; gap: 8px; margin-top: 16px;">
                                <button class="btn btn-sm btn-secondary" onclick="showGoalForm(${g.id})">Edit</button>
                                <button class="btn btn-sm btn-success" onclick="updateGoalProgress(${g.id}, ${Math.min(g.progress + 10, 100)})">+10%</button>
                                <button class="btn-icon btn-danger-icon" onclick="deleteGoal(${g.id})" title="Delete" aria-label="Delete">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `<div class="empty-state">
                <div class="empty-state-illustration">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                </div>
                <h3>No goals yet</h3>
                <p>Set meaningful goals and watch your progress grow step by step.</p>
                <button class="btn btn-primary" onclick="showGoalForm()">Set Goal</button>
            </div>`}
        `;
    } catch (error) {
        contentArea.innerHTML = `<div class="empty-state">Error: ${error.message}</div>`;
    }
}

function showGoalForm(id = null) {
    const fetchAndShow = async () => {
        let goal = null;
        if (id) {
            goal = await api(`/goals/${id}`);
        }
        
        openModal(id ? 'Edit Goal' : 'New Goal', `
            <form id="goalForm" onsubmit="saveGoal(event, ${id || 'null'})">
                <div class="form-group">
                    <label class="form-label">Title <span class="required-mark">*</span></label>
                    <input type="text" class="form-control" name="title" value="${escapeHtml(goal?.title || '')}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-control" name="description">${escapeHtml(goal?.description || '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Category</label>
                        <select class="form-control" name="category">
                            <option value="personal" ${goal?.category === 'personal' ? 'selected' : ''}>Personal</option>
                            <option value="work" ${goal?.category === 'work' ? 'selected' : ''}>Work</option>
                            <option value="health" ${goal?.category === 'health' ? 'selected' : ''}>Health</option>
                            <option value="finance" ${goal?.category === 'finance' ? 'selected' : ''}>Finance</option>
                            <option value="learning" ${goal?.category === 'learning' ? 'selected' : ''}>Learning</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Target Date</label>
                        <input type="date" class="form-control" name="target_date" value="${goal?.target_date || ''}">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Progress (${goal?.progress || 0}%)</label>
                    <input type="range" class="form-control" name="progress" min="0" max="100" value="${goal?.progress || 0}" oninput="this.nextElementSibling.textContent = this.value + '%'">
                    <span style="font-size: 0.875rem; color: var(--c-text2);">${goal?.progress || 0}%</span>
                </div>
                <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Goal</button>
                </div>
            </form>
        `);
    };
    
    fetchAndShow();
}

async function saveGoal(event, id) {
    event.preventDefault();
    const form = event.target;
    const data = {
        title: form.title.value,
        description: form.description.value || null,
        category: form.category.value,
        target_date: form.target_date.value || null,
        progress: parseInt(form.progress.value)
    };
    
    try {
        if (id) {
            await api(`/goals/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            showToast('Goal updated');
        } else {
            await api('/goals', { method: 'POST', body: JSON.stringify(data) });
            showToast('Goal created');
        }
        closeModal();
        renderGoals();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function updateGoalProgress(id, progress) {
    try {
        if (progress >= 100) {
            await api(`/goals/${id}`, { method: 'PUT', body: JSON.stringify({ progress, status: 'completed' }) });
            showToast('Goal completed! Congratulations!');
        } else {
            await api(`/goals/${id}`, { method: 'PUT', body: JSON.stringify({ progress }) });
            showToast('Progress updated');
        }
        renderGoals();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteGoal(id) {
    if (!confirm('Delete this goal?')) return;
    try {
        await api(`/goals/${id}`, { method: 'DELETE' });
        showToast('Goal deleted');
        renderGoals();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== DATA MANAGEMENT ====================

function showDataManagement() {
    navigateTo('data');
}

async function renderDataManagement() {
    contentArea.innerHTML = `
        <div class="section-header">
            <h2 class="section-title">Backup & Restore</h2>
        </div>
        
        <div class="card-grid" style="max-width: 600px;">
            <div class="card" style="text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 16px; color: var(--c-primary);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                </div>
                <h3 style="margin-bottom: 12px;">Export All Data</h3>
                <p style="color: var(--c-text2); margin-bottom: 20px; font-size: 0.9375rem;">
                    Download a JSON backup of everything: tasks, assets, transactions, journal, contacts, goals, and more.
                </p>
                <button class="btn btn-primary" onclick="exportAllData()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Download Backup
                </button>
            </div>
            
            <div class="card" style="text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 16px; color: var(--c-warning);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="3" y1="3" x2="21" y2="21"/>
                    </svg>
                </div>
                <h3 style="margin-bottom: 12px;">Restore From Backup</h3>
                <p style="color: var(--c-text2); margin-bottom: 20px; font-size: 0.9375rem;">
                    Upload a previous JSON backup to restore all data. This will <strong>replace</strong> your current data.
                </p>
                <div>
                    <label class="btn btn-success" style="cursor: pointer;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Upload Backup
                        <input type="file" accept=".json" style="display: none;" onchange="importAllData(event)">
                    </label>
                </div>
            </div>
        </div>
        
        <div class="card" style="max-width: 600px; margin-top: 24px;">
            <h3 style="margin-bottom: 12px;">Data Summary</h3>
            <div id="dataSummary" style="color: var(--c-text2); font-size: 0.9375rem;">
                Loading...
            </div>
        </div>
    `;
    
    // Show data counts
    try {
        const res = await fetch('/api/export');
        const data = await res.json();
        const counts = {
            'Tasks': data.tasks?.length || 0,
            'Assets': data.assets?.length || 0,
            'Transactions': data.transactions?.length || 0,
            'Journal Entries': data.journal_entries?.length || 0,
            'Contacts': data.contacts?.length || 0,
            'Goals': data.goals?.length || 0,
            'Learning Items': data.learning_items?.length || 0,
            'Events': data.events?.length || 0,
            'Health Entries': data.health_entries?.length || 0,
            'Documents': data.document_metadata?.length || 0,
        };
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        document.getElementById('dataSummary').innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px;">
                ${Object.entries(counts).map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('')}
            </div>
            <div style="border-top: 1px solid var(--c-border); padding-top: 12px; font-weight: 600;">Total Records: ${total}</div>
        `;
    } catch (e) {
        document.getElementById('dataSummary').textContent = 'Could not load data summary';
    }
}

async function exportAllData() {
    try {
        const res = await fetch('/api/export');
        const data = await res.json();
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `onelife-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showToast('Backup downloaded successfully');
    } catch (error) {
        showToast('Failed to export: ' + error.message, 'error');
    }
}

async function importAllData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!confirm('WARNING: This will REPLACE all your current data with the backup. Are you sure?')) {
        event.target.value = '';
        return;
    }
    
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        const res = await fetch('/api/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await res.json();
        
        if (res.ok) {
            showToast(`Restored ${result.count} records successfully`);
            setTimeout(() => location.reload(), 1000);
        } else {
            showToast('Import failed: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('Failed to import: ' + error.message, 'error');
    }
    
    event.target.value = '';
}

// ==================== INITIALIZATION ====================

// Init theme
initTheme();

// Show keyboard shortcut hint briefly
const hint = document.getElementById('shortcutsHint');
if (hint) {
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 4000);
}

// Load appropriate section from hash or default to dashboard
function handleRouting() {
    const hash = window.location.hash.substring(1);
    const section = hash || 'dashboard';
    if (sections[section]) {
        navigateTo(section);
    } else {
        navigateTo('dashboard');
    }
}
window.addEventListener('hashchange', handleRouting);
handleRouting();

// Back to top button
const backToTopBtn = document.getElementById('backToTop');
if (backToTopBtn) {
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(() => {
                if (window.scrollY > 300) {
                    backToTopBtn.classList.add('visible');
                } else {
                    backToTopBtn.classList.remove('visible');
                }
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });
}

// ==================== RIGHT PANEL ====================

const rightPanel = document.getElementById('rightPanel');
const rightPanelToggle = document.getElementById('rightPanelToggle');
if (rightPanel && rightPanelToggle) {
    const stored = localStorage.getItem('onelife-rp-collapsed');
    if (stored === '1') rightPanel.classList.add('collapsed');
    rightPanelToggle.addEventListener('click', () => {
        rightPanel.classList.toggle('collapsed');
        localStorage.setItem('onelife-rp-collapsed', rightPanel.classList.contains('collapsed') ? '1' : '0');
    });
}

// Quick capture
let qcMode = 'task';
document.querySelectorAll('.qc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.qc-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        qcMode = tab.dataset.qcTab;
        const ph = qcMode === 'task' ? 'Capture a task… (press Enter)'
                 : qcMode === 'note' ? 'Jot a quick note… (press Enter)'
                 : 'Add expense (e.g. 25k coffee)…';
        document.getElementById('qcInput').placeholder = ph;
    });
});
const qcInput = document.getElementById('qcInput');
if (qcInput) {
    const autoGrow = () => {
        qcInput.style.height = 'auto';
        qcInput.style.height = Math.min(qcInput.scrollHeight, 128) + 'px';
    };
    qcInput.addEventListener('input', autoGrow);
    qcInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = qcInput.value.trim();
            if (!text) return;
            try {
                if (qcMode === 'task') {
                    await api('/tasks', { method: 'POST', body: JSON.stringify({ title: text, priority: 'medium' }) });
                    showToast('Task added', 'success', { duration: 2000 });
                } else if (qcMode === 'note') {
                    await api('/journal', { method: 'POST', body: JSON.stringify({ date: new Date().toISOString().split('T')[0], content: text }) });
                    showToast('Note saved to journal', 'success', { duration: 2000 });
                } else if (qcMode === 'expense') {
                    const amt = parseFloat(text.replace(/[^0-9.]/g, ''));
                    if (amt > 0) {
                        await api('/transactions', { method: 'POST', body: JSON.stringify({ type: 'expense', amount: amt, date: new Date().toISOString().split('T')[0], category: 'other' }) });
                        showToast(`Expense ${formatCompact(amt)} added`, 'success', { duration: 2000 });
                    }
                }
                qcInput.value = '';
                autoGrow();
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    });
}

// Sticky note
const stickyText = document.getElementById('rpStickyText');
if (stickyText) {
    stickyText.value = localStorage.getItem('onelife-sticky') || '';
    let saveTimer;
    stickyText.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => localStorage.setItem('onelife-sticky', stickyText.value), 300);
    });
    const clearBtn = document.getElementById('rpStickyClear');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            stickyText.value = '';
            localStorage.removeItem('onelife-sticky');
        });
    }
}

// Mini calendar
(function initMiniCalendar() {
    const grid = document.getElementById('rpCalGrid');
    if (!grid) return;
    const monthLabel = document.getElementById('rpCalMonth');
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    let view = { y: new Date().getFullYear(), m: new Date().getMonth() };
    let eventsCache = {};

    async function loadEvents(y, m) {
        try {
            const start = new Date(y, m, 1).toISOString();
            const end = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
            const list = await api(`/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
            eventsCache[`${y}-${m}`] = new Set((list || []).map(e => {
                const d = e.start_time ? new Date(e.start_time) : null;
                return d ? d.getDate() : 0;
            }));
        } catch { eventsCache[`${y}-${m}`] = new Set(); }
    }

    function render() {
        const today = new Date();
        monthLabel.textContent = `${months[view.m]} ${view.y}`;
        const first = new Date(view.y, view.m, 1);
        const offset = first.getDay();
        const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
        const daysInPrev = new Date(view.y, view.m, 0).getDate();
        const events = eventsCache[`${view.y}-${view.m}`] || new Set();
        const dows = ['S','M','T','W','T','F','S'];
        let html = dows.map(d => `<div class="rp-cal-dow">${d}</div>`).join('');
        for (let i = 0; i < offset; i++) {
            html += `<div class="rp-cal-day muted">${daysInPrev - offset + i + 1}</div>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && view.m === today.getMonth() && view.y === today.getFullYear();
            const has = events.has(d);
            html += `<div class="rp-cal-day${isToday ? ' today' : ''}${has ? ' has-event' : ''}" data-day="${d}">${d}</div>`;
        }
        const totalCells = offset + daysInMonth;
        const trailing = (7 - (totalCells % 7)) % 7;
        for (let i = 1; i <= trailing; i++) {
            html += `<div class="rp-cal-day muted">${i}</div>`;
        }
        grid.innerHTML = html;
    }

    document.getElementById('rpCalPrev')?.addEventListener('click', () => {
        view.m--; if (view.m < 0) { view.m = 11; view.y--; }
        loadEvents(view.y, view.m).then(render);
    });
    document.getElementById('rpCalNext')?.addEventListener('click', () => {
        view.m++; if (view.m > 11) { view.m = 0; view.y++; }
        loadEvents(view.y, view.m).then(render);
    });

    loadEvents(view.y, view.m).then(render);
})();

// ==================== AGENDA WIDGET ====================

async function refreshAgenda() {
    const body = document.getElementById('rpAgendaBody');
    const count = document.getElementById('rpAgendaCount');
    if (!body) return;
    try {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();
        const all = await api(`/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
        const items = (all || []).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
        if (count) count.textContent = items.length === 1 ? '1 event' : `${items.length} events`;
        if (items.length === 0) {
            body.innerHTML = '<div class="rp-empty">Nothing scheduled</div>';
            return;
        }
        body.innerHTML = items.map(e => {
            const t = e.start_time ? new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            return `<div class="rp-agenda-item">
                <div class="rp-agenda-time">${t}</div>
                <div class="rp-agenda-dot"></div>
                <div class="rp-agenda-info">
                    <div class="rp-agenda-title">${escapeHtml(e.title)}</div>
                    <div class="rp-agenda-meta">${e.category || 'general'}</div>
                </div>
            </div>`;
        }).join('');
    } catch { /* ignore */ }
}

const _origNavigate = navigateTo;
navigateTo = function(section) {
    _origNavigate(section);
    const customizeBtn = document.getElementById('customizeWidgetsBtn');
    if (customizeBtn) {
        customizeBtn.style.display = section === 'dashboard' ? 'flex' : 'none';
    }
    if (section === 'dashboard') {
        refreshAgenda();
        initWidgetDragDrop();
    }
};
refreshAgenda();

// ==================== WIDGET DRAG-AND-DROP ====================

function initWidgetDragDrop() {
    const grid = document.getElementById('dashboardWidgets');
    if (!grid || grid.dataset.bound === '1') return;
    grid.dataset.bound = '1';

    const order = JSON.parse(localStorage.getItem('onelife-widget-order') || '[]');
    const hidden = JSON.parse(localStorage.getItem('onelife-widget-hidden') || '[]');
    hidden.forEach(id => {
        const w = grid.querySelector(`[data-widget-id="${id}"]`);
        if (w) w.style.display = 'none';
    });
    if (order.length) {
        const widgets = Array.from(grid.children).filter(w => w.style.display !== 'none');
        widgets.sort((a, b) => {
            const ai = order.indexOf(a.dataset.widgetId);
            const bi = order.indexOf(b.dataset.widgetId);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        widgets.forEach(w => grid.appendChild(w));
    }

    let dragId = null;
    grid.querySelectorAll('.widget').forEach(w => {
        w.addEventListener('dragstart', e => {
            dragId = w.dataset.widgetId;
            w.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        w.addEventListener('dragend', () => {
            w.classList.remove('dragging');
            grid.querySelectorAll('.widget').forEach(x => x.classList.remove('drop-target'));
            const newOrder = Array.from(grid.children).filter(x => x.style.display !== 'none').map(c => c.dataset.widgetId);
            localStorage.setItem('onelife-widget-order', JSON.stringify(newOrder));
        });
        w.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (w.dataset.widgetId !== dragId && w.style.display !== 'none') w.classList.add('drop-target');
        });
        w.addEventListener('dragleave', () => w.classList.remove('drop-target'));
        w.addEventListener('drop', e => {
            e.preventDefault();
            const draggedEl = grid.querySelector(`[data-widget-id="${dragId}"]`);
            if (!draggedEl || draggedEl === w) return;
            const rect = w.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            grid.insertBefore(draggedEl, after ? w.nextSibling : w);
        });
    });
}

const customizeBtn = document.getElementById('customizeWidgetsBtn');
if (customizeBtn) {
    customizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const grid = document.getElementById('dashboardWidgets');
        if (!grid) return;
        let menu = document.getElementById('widgetMenu');
        if (menu) { menu.remove(); return; }
        const widgets = Array.from(grid.children);
        const hidden = JSON.parse(localStorage.getItem('onelife-widget-hidden') || '[]');
        menu = document.createElement('div');
        menu.id = 'widgetMenu';
        menu.className = 'widget-menu open';
        menu.innerHTML = `
            <div style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--c-text3);padding:6px 8px 4px">Customize widgets</div>
            ${widgets.map(w => {
                const isHidden = w.style.display === 'none';
                const labels = { heatmap: 'Activity heatmap', habits: 'Habits', goals: 'Goals' };
                return `<label class="widget-menu-item">
                    <input type="checkbox" ${!isHidden ? 'checked' : ''} data-toggle="${w.dataset.widgetId}">
                    <span>${labels[w.dataset.widgetId] || w.dataset.widgetId}</span>
                </label>`;
            }).join('')}
            <div style="border-top:1px solid var(--c-border);margin-top:6px;padding-top:6px">
                <button class="widget-menu-item" id="resetWidgetOrder" style="width:100%;background:transparent;border:none;font-family:var(--font);cursor:pointer;color:var(--c-text2)">↺ Reset to default order</button>
            </div>
        `;
        document.querySelector('.main-content').appendChild(menu);
        menu.addEventListener('click', ev => {
            const cb = ev.target.closest('input[type=checkbox][data-toggle]');
            if (cb) {
                const id = cb.dataset.toggle;
                const w = grid.querySelector(`[data-widget-id="${id}"]`);
                if (w) w.style.display = cb.checked ? '' : 'none';
                const h = JSON.parse(localStorage.getItem('onelife-widget-hidden') || '[]');
                if (cb.checked) {
                    const i = h.indexOf(id);
                    if (i >= 0) h.splice(i, 1);
                } else {
                    if (h.indexOf(id) < 0) h.push(id);
                }
                localStorage.setItem('onelife-widget-hidden', JSON.stringify(h));
            }
            if (ev.target.id === 'resetWidgetOrder') {
                localStorage.removeItem('onelife-widget-order');
                localStorage.removeItem('onelife-widget-hidden');
                navigateTo('dashboard');
            }
        });
        setTimeout(() => {
            document.addEventListener('click', function close(ev) {
                if (menu && !menu.contains(ev.target) && ev.target !== customizeBtn) {
                    menu.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 0);
    });
}
