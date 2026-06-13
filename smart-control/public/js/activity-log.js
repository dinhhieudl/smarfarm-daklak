/**
 * SmartFarm DakLak — Activity Log Frontend
 * Farm activity journal: planting, fertilizing, spraying, harvesting...
 */
const ActivityLog = (() => {
  const TYPES = {
    planting: { icon: '🌱', label: 'Trồng', color: '#4caf50' },
    fertilizing: { icon: '🌿', label: 'Bón phân', color: '#8bc34a' },
    spraying: { icon: '🧪', label: 'Phun thuốc', color: '#ff9800' },
    irrigating: { icon: '💧', label: 'Tưới nước', color: '#2196f3' },
    harvesting: { icon: '🧺', label: 'Thu hoạch', color: '#e53935' },
    pruning: { icon: '✂️', label: 'Tỉa cành', color: '#795548' },
    mulching: { icon: '🍂', label: 'Phủ rơm', color: '#8d6e63' },
    soil_test: { icon: '🧪', label: 'Xét nghiệm đất', color: '#9c27b0' },
    pest_control: { icon: '🐛', label: 'Trừ sâu bệnh', color: '#f44336' },
    maintenance: { icon: '🔧', label: 'Bảo trì', color: '#607d8b' },
    other: { icon: '📝', label: 'Khác', color: '#9e9e9e' }
  };

  let activities = [];
  let filterType = '';
  let filterZone = '';

  async function loadActivities() {
    try {
      let url = '/api/activities?limit=100';
      if (filterType) url += `&type=${filterType}`;
      if (filterZone) url += `&zoneId=${filterZone}`;
      const data = await API.request(url.replace('/api', ''));
      activities = Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('[ActivityLog] Load failed:', err.message);
      activities = [];
    }
  }

  async function addActivity(data) {
    try {
      const result = await API.request('/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      activities.unshift(result);
      renderList();
      return result;
    } catch (err) {
      console.warn('[ActivityLog] Add failed:', err.message);
      throw err;
    }
  }

  async function deleteActivity(id) {
    try {
      await API.request(`/activities/${id}`, { method: 'DELETE' });
      activities = activities.filter(a => a.id !== id);
      renderList();
    } catch (err) {
      console.warn('[ActivityLog] Delete failed:', err.message);
    }
  }

  function render(state) {
    const container = document.getElementById('tab-activities');
    if (!container) return;

    injectStyles();
    const zones = state.zones || [];

    container.innerHTML = `
      <div class="act-container">
        <!-- Add Activity Form -->
        <div class="card act-form-card">
          <div class="card-title"><span class="icon">📝</span> Ghi nhận hoạt động</div>
          <form id="activity-form" class="act-form">
            <div class="act-form-row">
              <div class="act-field">
                <label>Loại hoạt động</label>
                <select id="act-type" required>
                  ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
                </select>
              </div>
              <div class="act-field">
                <label>Khu vực</label>
                <select id="act-zone">
                  <option value="">-- Chọn khu vực --</option>
                  ${zones.map(z => `<option value="${z.id}">${z.name}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="act-form-row">
              <div class="act-field" style="flex:2">
                <label>Tiêu đề</label>
                <input type="text" id="act-title" placeholder="VD: Bón phân NPK cho khu A" required>
              </div>
            </div>
            <div class="act-form-row">
              <div class="act-field" style="flex:2">
                <label>Mô tả chi tiết</label>
                <textarea id="act-desc" placeholder="Ghi chú thêm..." rows="2"></textarea>
              </div>
            </div>
            <div class="act-form-row">
              <div class="act-field">
                <label>Số lượng</label>
                <input type="number" id="act-qty" placeholder="0" step="0.1">
              </div>
              <div class="act-field">
                <label>Đơn vị</label>
                <input type="text" id="act-unit" placeholder="kg, lít, lần...">
              </div>
              <div class="act-field">
                <label>Sản phẩm</label>
                <input type="text" id="act-product" placeholder="NPK 20-10-10...">
              </div>
              <div class="act-field">
                <label>Chi phí (VNĐ)</label>
                <input type="number" id="act-cost" placeholder="0">
              </div>
            </div>
            <button type="submit" class="act-submit-btn">➕ Ghi nhận</button>
          </form>
        </div>

        <!-- Filters -->
        <div class="act-filters">
          <select id="act-filter-type" onchange="ActivityLog.onFilterChange()">
            <option value="">Tất cả loại</option>
            ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
          </select>
          <select id="act-filter-zone" onchange="ActivityLog.onFilterChange()">
            <option value="">Tất cả khu vực</option>
            ${zones.map(z => `<option value="${z.id}">${z.name}</option>`).join('')}
          </select>
          <span class="act-count" id="act-count">0 hoạt động</span>
        </div>

        <!-- Activity List -->
        <div class="act-list" id="act-list">
          <div class="empty">Đang tải...</div>
        </div>
      </div>
    `;

    bindForm();
    loadActivities().then(() => renderList());
  }

  function renderList() {
    const container = document.getElementById('act-list');
    if (!container) return;

    if (activities.length === 0) {
      container.innerHTML = '<div class="empty">Chưa có hoạt động nào. Hãy ghi nhận hoạt động đầu tiên!</div>';
      updateCount();
      return;
    }

    container.innerHTML = activities.map(act => {
      const typeDef = TYPES[act.type] || TYPES.other;
      const time = new Date(act.timestamp);
      const dateStr = time.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="act-item">
          <div class="act-item-icon" style="background:${typeDef.color}20;color:${typeDef.color}">${typeDef.icon}</div>
          <div class="act-item-body">
            <div class="act-item-header">
              <span class="act-item-title">${act.title}</span>
              <span class="act-item-type" style="color:${typeDef.color}">${typeDef.label}</span>
            </div>
            ${act.description ? `<div class="act-item-desc">${act.description}</div>` : ''}
            <div class="act-item-meta">
              ${act.zoneId ? `<span>📍 ${act.zoneId}</span>` : ''}
              ${act.quantity ? `<span>📦 ${act.quantity} ${act.unit || ''}</span>` : ''}
              ${act.product ? `<span>🏷️ ${act.product}</span>` : ''}
              ${act.cost ? `<span>💰 ${Number(act.cost).toLocaleString('vi-VN')} VNĐ</span>` : ''}
              <span>🕐 ${dateStr} ${timeStr}</span>
            </div>
          </div>
          <button class="act-delete-btn" onclick="ActivityLog.deleteActivity('${act.id}')" title="Xóa">🗑️</button>
        </div>
      `;
    }).join('');

    updateCount();
  }

  function updateCount() {
    const el = document.getElementById('act-count');
    if (el) el.textContent = `${activities.length} hoạt động`;
  }

  function bindForm() {
    const form = document.getElementById('activity-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        type: document.getElementById('act-type').value,
        zoneId: document.getElementById('act-zone').value || null,
        title: document.getElementById('act-title').value.trim(),
        description: document.getElementById('act-desc').value.trim(),
        quantity: document.getElementById('act-qty').value || null,
        unit: document.getElementById('act-unit').value.trim() || null,
        product: document.getElementById('act-product').value.trim() || null,
        cost: document.getElementById('act-cost').value || null
      };

      if (!data.title) return;

      try {
        await addActivity(data);
        form.reset();
        Alerts.show('info', 'Đã ghi nhận', `${TYPES[data.type]?.label || 'Hoạt động'}: ${data.title}`);
      } catch (err) {
        Alerts.show('warning', 'Lỗi', 'Không thể ghi nhận hoạt động');
      }
    });
  }

  function onFilterChange() {
    filterType = document.getElementById('act-filter-type')?.value || '';
    filterZone = document.getElementById('act-filter-zone')?.value || '';
    loadActivities().then(() => renderList());
  }

  function injectStyles() {
    if (document.getElementById('activitylog-styles')) return;
    const style = document.createElement('style');
    style.id = 'activitylog-styles';
    style.textContent = `
      .act-container { padding: 20px; max-width: 900px; margin: 0 auto; }
      .act-form-card { margin-bottom: 16px; }
      .act-form { display: flex; flex-direction: column; gap: 12px; }
      .act-form-row { display: flex; gap: 12px; flex-wrap: wrap; }
      .act-field { flex: 1; min-width: 120px; }
      .act-field label { display: block; font-size: .75rem; color: var(--text2); margin-bottom: 4px; font-weight: 600; }
      .act-field input, .act-field select, .act-field textarea {
        width: 100%; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border);
        border-radius: 8px; color: var(--text); font-size: .85rem; min-height: 40px;
      }
      .act-field textarea { resize: vertical; font-family: inherit; }
      .act-field input:focus, .act-field select:focus, .act-field textarea:focus { outline: none; border-color: var(--green); }
      .act-submit-btn {
        padding: 10px 24px; background: var(--green); color: var(--bg); border: none;
        border-radius: 8px; font-weight: 700; font-size: .9rem; cursor: pointer;
        align-self: flex-start; min-height: 44px; transition: all .2s;
      }
      .act-submit-btn:hover { background: var(--green2); }

      .act-filters { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
      .act-filters select { padding: 6px 12px; background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: .8rem; }
      .act-count { font-size: .75rem; color: var(--text3); margin-left: auto; }

      .act-list { display: flex; flex-direction: column; gap: 8px; }
      .act-item {
        display: flex; align-items: flex-start; gap: 12px; padding: 12px;
        background: var(--bg2); border: 1px solid var(--border); border-radius: 10px;
        transition: border-color .2s;
      }
      .act-item:hover { border-color: var(--green2); }
      .act-item-icon { font-size: 1.5rem; min-width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
      .act-item-body { flex: 1; min-width: 0; }
      .act-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px; }
      .act-item-title { font-weight: 700; font-size: .9rem; }
      .act-item-type { font-size: .7rem; font-weight: 600; white-space: nowrap; }
      .act-item-desc { font-size: .8rem; color: var(--text2); margin-bottom: 6px; }
      .act-item-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: .7rem; color: var(--text3); }
      .act-delete-btn { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 8px; min-width: 44px; min-height: 44px; opacity: .5; transition: opacity .2s; }
      .act-delete-btn:hover { opacity: 1; }

      @media (max-width: 767px) {
        .act-form-row { flex-direction: column; }
        .act-item { flex-direction: column; }
      }
    `;
    document.head.appendChild(style);
  }

  return {
    render,
    onFilterChange,
    deleteActivity
  };
})();
