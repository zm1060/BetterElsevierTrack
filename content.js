// === 1️⃣ 拦截 XMLHttpRequest ===
const XHR = XMLHttpRequest.prototype;
const open = XHR.open;
const send = XHR.send;

// 拦截 open 方法，记录请求 URL
XHR.open = function() {
    this.requestMethod = arguments[0];
    this.requestURL = arguments[1];
    return open.apply(this, arguments);
};

// 拦截 send 方法，在请求完成后处理响应
XHR.send = function() {
    this.addEventListener('load', function() {
        try {
            console.log('✅ 拦截到 XHR 请求:', this.requestURL);
            if (this.requestURL && this.requestURL.includes('/tracker/')) {
                const data = JSON.parse(this.responseText);
                console.log('✅ XHR API 响应数据:', data);

                if (data.ManuscriptTitle && data.ReviewEvents) {
                    console.log('✅ 数据符合要求，调用 renderPage');
                    renderPage(data);
                } else {
                    console.warn('⚠️ 数据不符合要求，不触发 renderPage:', data);
                }
            }
        } catch (err) {
            console.error('❌ XHR 解析 API 响应错误:', err);
        }
    });

    return send.apply(this, arguments);
};

// === 2️⃣ 拦截 fetch 请求 ===
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
        const url = args[0];
        if (typeof url === 'string' && url.includes('/tracker/')) {
            console.log('✅ 拦截到 fetch API 请求:', url);

            const responseClone = response.clone();
            const data = await responseClone.json();

            console.log('✅ fetch API 响应数据:', data);

            if (data.ManuscriptTitle && data.ReviewEvents) {
                console.log('✅ 数据符合要求，调用 renderPage');
                renderPage(data);
            } else {
                console.warn('⚠️ 数据不符合要求，不触发 renderPage:', data);
            }
        }
    } catch (err) {
        console.error('❌ fetch 解析 API 响应错误:', err);
    }

    return response;
};

/************************************
 * 1️⃣ 格式化日期时间：精确到秒
 ************************************/
function formatDateTime(timestamp) {
    if (!timestamp) return 'In Progress'; 
    // 假设 timestamp 为「秒」级时间戳；如果是毫秒级，改为 new Date(timestamp)
    const date = new Date(timestamp * 1000);
    
    const year   = date.getFullYear();
    const month  = String(date.getMonth() + 1).padStart(2, '0');
    const day    = String(date.getDate()).padStart(2, '0');
    const hour   = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
  }
  
  /************************************
   * 2️⃣ 计算天数差：保留两位小数
   ************************************/
  function calcDaysDiff(start, end) {
    if (!start || !end) return null; // 表示还未完成
    // 单位：秒
    const diffSeconds = end - start;
    // 转换为天数，保留两位小数
    const diffDays = diffSeconds / (60 * 60 * 24);
    return diffDays.toFixed(2);
  }
  
  /************************************
   * 3️⃣ 将 ReviewEvents 按 reviewerId 聚合
   *    并设置状态：未接收、已接收、已完成
   ************************************/
  function aggregateReviewers(events) {
    const reviewers = [];
    const reviewerMap = new Map();
    
    if (!events || !Array.isArray(events)) return reviewers;
    
    events.forEach(event => {
        const id = event.Id;
        if (!reviewerMap.has(id)) {
            reviewerMap.set(id, {
                Id: id,
                Status: 'Invited',
                InvitedDate: null,
                AcceptedDate: null,
                CompletedDate: null,
                LastUpdateDate: null // 添加最后更新时间
            });
        }
        
        const reviewer = reviewerMap.get(id);
        const eventDate = event.Date;
        
        if (event.Event === 'REVIEWER_INVITED') {
            reviewer.InvitedDate = eventDate;
            reviewer.LastUpdateDate = eventDate;
        } else if (event.Event === 'REVIEWER_ACCEPTED') {
            reviewer.Status = 'In Review';
            reviewer.AcceptedDate = eventDate;
            reviewer.LastUpdateDate = eventDate;
        } else if (event.Event === 'REVIEWER_COMPLETED') {
            reviewer.Status = 'Completed';
            reviewer.CompletedDate = eventDate;
            reviewer.LastUpdateDate = eventDate;
        }
    });
    
    // 转换为数组并排序
    const sortedReviewers = Array.from(reviewerMap.values());
    
    // 排序规则：
    // 1. 已完成的排在前面
    // 2. 正在审稿的排在中间
    // 3. 仅被邀请的排在最后
    // 4. 同状态下按最后更新时间倒序
    sortedReviewers.sort((a, b) => {
        const statusOrder = {
            'Completed': 0,
            'In Review': 1,
            'Invited': 2
        };
        
        if (statusOrder[a.Status] !== statusOrder[b.Status]) {
            return statusOrder[a.Status] - statusOrder[b.Status];
        }
        
        // 同状态按最后更新时间倒序
        return b.LastUpdateDate - a.LastUpdateDate;
    });
    
    return sortedReviewers;
  }
  
  /************************************
   * 4️⃣ 渲染审稿人卡片（左右两列）
   ************************************/
  function renderReviewersHTML(reviewers) {
    return reviewers.map(r => {
      // 如果没有日期，显示更明确的文案
      const invitedStr  = r.InvitedDate  ? formatDateTime(r.InvitedDate)  : 'Not invited';
      const acceptedStr = r.AcceptedDate ? formatDateTime(r.AcceptedDate) : 'Not accepted';
      const responseTimeStr = r.ResponseTime ? `${r.ResponseTime} days` : 'In Progress';
      const reviewTimeStr   = r.ReviewTime   ? `${r.ReviewTime} days`   : 'In Progress';
      
      // 状态颜色：Completed 为绿色，其它状态使用蓝色
      const statusColor = (r.Status === 'Completed') ? 'green' : '#007bff';
  
      return `
        <div class="reviewer-row" 
             style="
               display: flex; 
               justify-content: space-between; 
               align-items: flex-start; 
               border: 1px solid #ddd; 
               padding: 15px; 
               border-radius: 8px; 
               margin-bottom: 15px;
             ">
          <!-- 左列：Reviewer #X, Invited, Accepted -->
          <div class="left-col" style="max-width: 40%;">
            <div style="font-weight: bold; font-size: 16px; margin-bottom: 5px;">
              Reviewer #${r.Id}
            </div>
            <div style="color: #555;">
              <div>Invited: ${invitedStr}</div>
              <div>Accepted: ${acceptedStr}</div>
            </div>
          </div>
  
          <!-- 右列：Response Time, Review Time, Status -->
          <div class="right-col" style="display: flex; gap: 40px; max-width: 60%; justify-content: flex-end;">
            <!-- Response Time -->
            <div style="text-align: left;">
              <div style="font-size: 14px; color: #999;">Response Time</div>
              <div style="font-size: 16px;">${responseTimeStr}</div>
            </div>
            <!-- Review Time -->
            <div style="text-align: left;">
              <div style="font-size: 14px; color: #999;">Review Time</div>
              <div style="font-size: 16px;">${reviewTimeStr}</div>
            </div>
            <!-- Status -->
            <div style="text-align: left;">
              <div style="font-size: 14px; color: #999;">Status</div>
              <div style="font-size: 16px; font-weight: bold; color: ${statusColor};">
                ${r.Status}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  /************************************
   * 5️⃣ renderPage 主函数
   ************************************/
  function renderPage(data) {
    console.log('✅ renderPage 被调用，数据:', data);
    
    // 创建监控面板（如果尚未创建）
    if (!document.querySelector('.monitor-panel')) {
        createMonitorPanel(data);
    }
    
    // 更新面板数据
    updateMonitorPanel(data);
    
    // 聚合审稿人数据
    const reviewers = aggregateReviewers(data.ReviewEvents);
    
    // 计算响应时间和审稿时间
    reviewers.forEach(reviewer => {
        reviewer.ResponseTime = calcDaysDiff(reviewer.InvitedDate, reviewer.AcceptedDate);
        reviewer.ReviewTime = calcDaysDiff(reviewer.AcceptedDate, reviewer.CompletedDate);
    });
    
    // 渲染详细审稿人卡片
    if (document.querySelector('.show-detailed-view')) {
        renderDetailedReviewerCards(reviewers);
    }
    
    // 添加"查看详细"按钮（如果不存在）
    if (!document.querySelector('.show-detailed-view')) {
        const panel = document.querySelector('.monitor-panel');
        if (panel) {
            const statsSection = panel.querySelector('.stats-section');
            if (statsSection) {
                const detailButton = document.createElement('button');
                detailButton.className = 'show-detailed-view';
                detailButton.textContent = '📊 查看详细审稿状态';
                detailButton.onclick = () => {
                    const existingCards = document.querySelector('.reviewer-cards-container');
                    if (existingCards) {
                        existingCards.style.display = existingCards.style.display === 'none' ? 'block' : 'none';
                        detailButton.textContent = existingCards.style.display === 'none' ? '📊 查看详细审稿状态' : '📊 隐藏详细状态';
                    } else {
                        renderDetailedReviewerCards(reviewers);
                        detailButton.textContent = '📊 隐藏详细状态';
                    }
                };
                
                statsSection.appendChild(detailButton);
                
                // 添加按钮样式
                const style = document.getElementById('monitor-panel-styles');
                if (style) {
                    style.textContent += `
                        .show-detailed-view {
                            margin-top: 15px;
                            width: 100%;
                            background: #1a73e8;
                            color: white;
                            border: none;
                            padding: 10px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-weight: 500;
                            transition: all 0.2s ease;
                        }
                        
                        .show-detailed-view:hover {
                            background: #1557b0;
                            transform: translateY(-1px);
                        }
                    `;
                }
            }
        }
    }
  }
  
  // 更新监控面板数据
  function updateMonitorPanel(data) {
    const panel = document.querySelector('.monitor-panel');
    if (!panel) return;
    
    // 聚合审稿人数据
    const reviewers = aggregateReviewers(data.ReviewEvents);
    
    // 计算统计数据
    const stats = {
        completed: reviewers.filter(r => r.Status === 'Completed').length,
        accepted: reviewers.filter(r => r.Status === 'In Review').length,
        invited: reviewers.filter(r => r.Status === 'Invited').length,
        total: reviewers.length
    };
    
    // 计算响应时间和审稿时间
    reviewers.forEach(reviewer => {
        reviewer.ResponseTime = calcDaysDiff(reviewer.InvitedDate, reviewer.AcceptedDate);
        reviewer.ReviewTime = calcDaysDiff(reviewer.AcceptedDate, reviewer.CompletedDate);
    });
    
    // 更新论文信息
    const titleEl = panel.querySelector('.paper-title');
    const journalEl = panel.querySelector('.paper-journal');
    
    if (titleEl) titleEl.textContent = data.ManuscriptTitle || '未知标题';
    if (journalEl) journalEl.textContent = data.JournalName || data.JournalAcronym || '未知期刊';
    
    // 添加统计信息区域（如果不存在）
    if (!panel.querySelector('.stats-section')) {
        const monitorContent = panel.querySelector('.monitor-content');
        const inputSection = panel.querySelector('.input-section');
        
        const statsSection = document.createElement('div');
        statsSection.className = 'stats-section';
        statsSection.innerHTML = `
            <div class="stats-header">审稿状态统计</div>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">已邀请</span>
                    <span id="invitedCount" class="stat-value">${stats.invited+stats.accepted+stats.completed}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">审稿中</span>
                    <span id="acceptedCount" class="stat-value">${stats.accepted+stats.completed}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">已完成</span>
                    <span id="completedCount" class="stat-value">${stats.completed}</span>
                </div>
            </div>
            
            <div class="progress-container">
                <div class="progress-label">
                    <span>审稿进度</span>
                    <span>${stats.completed}/${stats.accepted+stats.completed} 完成</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${(stats.completed / (stats.accepted+stats.completed)) * 100}%"></div>
                </div>
            </div>
            
            <div class="reviewer-list">
                <div class="reviewer-list-header">审稿人状态</div>
                <div class="reviewer-items">
                    ${reviewers.map(reviewer => `
                        <div class="reviewer-item ${reviewer.Status.toLowerCase().replace(' ', '-')}">
                            <span class="reviewer-id">#${reviewer.Id}</span>
                            <span class="reviewer-status ${reviewer.Status.toLowerCase().replace(' ', '-')}">${getStatusText(reviewer.Status)}</span>
                            <span class="reviewer-date">${formatDate(getLatestDate(reviewer))}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        monitorContent.insertBefore(statsSection, inputSection);
        
        // 添加相关样式
        const style = document.getElementById('monitor-panel-styles');
        if (style) {
            style.textContent += `
                .progress-container {
                    margin: 15px 0;
                }
                
                .progress-label {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 6px;
                    font-size: 12px;
                    color: #5f6368;
                }
                
                .progress-bar {
                    height: 8px;
                    background-color: #e0e0e0;
                    border-radius: 4px;
                    overflow: hidden;
                }
                
                .progress-fill {
                    height: 100%;
                    background-color: #34a853;
                    border-radius: 4px;
                    transition: width 0.3s ease;
                }
            `;
        }
    } else {
        // 更新已有的统计信息
        panel.querySelector('#invitedCount').textContent = stats.invited;
        panel.querySelector('#acceptedCount').textContent = stats.accepted;
        panel.querySelector('#completedCount').textContent = stats.completed;
        
        // 更新进度条
        const progressFill = panel.querySelector('.progress-fill');
        const progressLabel = panel.querySelector('.progress-label span:last-child');
        if (progressFill && progressLabel) {
            progressFill.style.width = `${(stats.completed / stats.total) * 100}%`;
            progressLabel.textContent = `${stats.completed}/${stats.total} 完成`;
        }
        
        // 更新审稿人列表
        const reviewerItems = panel.querySelector('.reviewer-items');
        if (reviewerItems) {
            reviewerItems.innerHTML = reviewers.map(reviewer => {
                // 获取状态对应的图标和颜色
                const statusConfig = {
                    'Completed': {
                        icon: '✅',
                        color: '#34a853',
                        text: '已完成审稿'
                    },
                    'In Review': {
                        icon: '🔍',
                        color: '#4285f4',
                        text: '正在审稿'
                    },
                    'Invited': {
                        icon: '⏳',
                        color: '#fbbc05',
                        text: '已邀请'
                    }
                }[reviewer.Status];

                // 格式化最后更新时间
                const lastUpdateTime = formatDateTime(reviewer.LastUpdateDate);
                
                return `
                    <div class="reviewer-item ${reviewer.Status.toLowerCase().replace(' ', '-')}"
                         style="border-left: 4px solid ${statusConfig.color}">
                        <div class="reviewer-main-info">
                            <span class="reviewer-id">#${reviewer.Id}</span>
                            <span class="reviewer-status ${reviewer.Status.toLowerCase().replace(' ', '-')}">
                                ${statusConfig.icon} ${statusConfig.text}
                            </span>
                        </div>
                        <div class="reviewer-time-info">
                            <span class="reviewer-date">最后更新: ${lastUpdateTime}</span>
                        </div>
                    </div>
                `;
            }).join('');
            
            // 添加新的样式
            const style = document.getElementById('monitor-panel-styles');
            if (style) {
                style.textContent += `
                    .reviewer-item {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 12px 15px;
                        margin-bottom: 8px;
                        background: white;
                        border-radius: 6px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                        transition: transform 0.2s ease;
                    }
                    
                    .reviewer-item:hover {
                        transform: translateX(4px);
                    }
                    
                    .reviewer-main-info {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }
                    
                    .reviewer-id {
                        font-weight: 600;
                        color: #202124;
                    }
                    
                    .reviewer-status {
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        font-size: 14px;
                    }
                    
                    .reviewer-time-info {
                        font-size: 12px;
                        color: #5f6368;
                    }
                `;
            }
        }
    }
}

// 辅助函数：获取状态文本
function getStatusText(status) {
    switch (status) {
        case 'Invited': return '已邀请';
        case 'In Review': return '审稿中';
        case 'Completed': return '已完成';
        default: return status;
    }
}

// 辅助函数：获取最新日期
function getLatestDate(reviewer) {
    if (reviewer.CompletedDate) return reviewer.CompletedDate;
    if (reviewer.AcceptedDate) return reviewer.AcceptedDate;
    return reviewer.InvitedDate;
}

// 辅助函数：格式化日期
function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// === 消息监听 ===
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('✅ Content script received message:', message);
    
    if (message.type === 'TRACKER_DATA' && message.data) {
        try {
            if (message.data.ManuscriptTitle && message.data.ReviewEvents) {
                console.log('✅ 收到有效数据，调用 renderPage');
                renderPage(message.data);
                
                // 确保监控面板已创建
                if (!document.querySelector('.monitor-panel')) {
                    createMonitorPanel(message.data);
                }
            } else {
                console.warn('⚠️ 收到的数据不符合要求:', message.data);
            }
        } catch (err) {
            console.error('❌ 处理消息数据时出错:', err);
        }
    }
    
    return true; // 保持消息通道开放
});

// === 创建监控面板 ===
function createMonitorPanel(data) {
    // 如果已存在，则不重复创建
    if (document.querySelector('.monitor-panel')) return;
    
    const panel = document.createElement('div');
    panel.className = 'monitor-panel';
    panel.innerHTML = `
        <div class="monitor-header">
            <h3>论文审稿监控</h3>
            <button class="minimize-btn">_</button>
        </div>
        <div class="monitor-content">
            <div class="paper-info">
                <div class="paper-title">${data.ManuscriptTitle || '未知标题'}</div>
                <div class="paper-journal">${data.JournalName || data.JournalAcronym || '未知期刊'}</div>
            </div>
            
            <div class="privacy-notice">
                <i class="notice-icon">⚠️</i>
                <span>隐私提示：您的邮箱和论文信息将被发送至监控服务器以接收状态变更通知</span>
            </div>
            
            <div class="input-section">
                <div class="input-group">
                    <label for="monitor-email">接收通知邮箱</label>
                    <input type="email" id="monitor-email" placeholder="请输入邮箱地址">
                </div>
                
                <div class="input-group">
                    <label for="monitor-interval">检查间隔</label>
                    <select id="monitor-interval">
                        <option value="1800">30分钟</option>
                        <option value="3600">1小时</option>
                        <option value="7200">2小时</option>
                        <option value="14400">4小时</option>
                    </select>
                </div>

                <div class="button-group">
                    <button id="monitor-start" class="primary">开始监控</button>
                    <button id="monitor-stop" class="secondary" disabled>停止监控</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(panel);
    
    // 添加样式
    addMonitorPanelStyles();
    
    // 初始化面板功能
    initializeMonitorPanel(data);
}

// === 添加监控面板样式 ===
function addMonitorPanelStyles() {
    // 如果已存在样式，则不重复添加
    if (document.getElementById('monitor-panel-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'monitor-panel-styles';
    style.textContent = `
        .monitor-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 340px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            border: 1px solid #e6e6e6;
            transition: all 0.3s ease;
            overflow: hidden;
        }
        
        .monitor-panel.minimized {
            height: 50px;
            overflow: hidden;
        }

        .monitor-header {
            background: linear-gradient(135deg, #1a73e8, #0d47a1);
            color: white;
            padding: 14px 18px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 14px;
        }
        
        .monitor-header h3 {
            margin: 0;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .monitor-header h3::before {
            content: '📊';
            font-size: 16px;
        }

        .minimize-btn {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: all 0.2s;
        }
        
        .minimize-btn:hover {
            background: rgba(255,255,255,0.2);
        }

        .monitor-content {
            padding: 18px;
        }

        .paper-info {
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px solid #eee;
        }

        .paper-title {
            font-size: 15px;
            color: #202124;
            margin-bottom: 6px;
            line-height: 1.4;
            font-weight: 500;
        }

        .paper-journal {
            font-size: 13px;
            color: #5f6368;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .paper-journal::before {
            content: '📄';
            font-size: 12px;
        }

        .privacy-notice {
            background: #fff8e1;
            color: #b0741e;
            padding: 10px 12px;
            border-radius: 6px;
            font-size: 12px;
            margin-bottom: 18px;
            line-height: 1.4;
            display: flex;
            align-items: flex-start;
            gap: 8px;
            border-left: 3px solid #ffc107;
        }
        
        .notice-icon {
            font-style: normal;
        }

        button {
            font-family: inherit;
            border: none;
            border-radius: 6px;
            padding: 10px 16px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        button.primary {
            background: #1a73e8;
            color: white;
        }
        
        button.primary:hover {
            background: #0d47a1;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        button.secondary {
            background: #ea4335;
            color: white;
        }
        
        button.secondary:hover {
            background: #c5221f;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            box-shadow: none;
        }

        .input-group {
            margin-bottom: 15px;
        }

        .input-group label {
            display: block;
            margin-bottom: 8px;
            color: #5f6368;
            font-size: 13px;
            font-weight: 500;
        }

        .input-group input,
        .input-group select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #dadce0;
            border-radius: 6px;
            font-size: 14px;
            transition: border 0.2s;
            background: #f8f9fa;
        }
        
        .input-group input:focus,
        .input-group select:focus {
            border-color: #1a73e8;
            outline: none;
            background: white;
        }
        
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        
        /* 统计部分样式 */
        .stats-section {
            margin-bottom: 18px;
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            border: 1px solid #f1f3f4;
        }
        
        .stats-header, .reviewer-list-header {
            font-size: 14px;
            font-weight: 500;
            color: #202124;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .stats-header::before {
            content: '📈';
            font-size: 14px;
        }
        
        .reviewer-list-header::before {
            content: '👥';
            font-size: 14px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .stat-item {
            background: white;
            border-radius: 6px;
            padding: 10px;
            text-align: center;
            border: 1px solid #e8eaed;
        }
        
        .stat-label {
            display: block;
            font-size: 12px;
            color: #5f6368;
            margin-bottom: 5px;
        }
        
        .stat-value {
            font-size: 18px;
            font-weight: 600;
            color: #1a73e8;
        }
        
        .reviewer-list {
            margin-top: 15px;
        }
        
        .reviewer-items {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid #dadce0;
            border-radius: 6px;
            background: white;
        }
        
        .reviewer-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 12px;
            border-bottom: 1px solid #f1f3f4;
            font-size: 13px;
            transition: background 0.2s;
        }
        
        .reviewer-item:hover {
            background: #f8f9fa;
        }
        
        .reviewer-item:last-child {
            border-bottom: none;
        }
        
        .reviewer-item.completed {
            background-color: #e6f4ea;
        }
        
        .reviewer-item.in.review {
            background-color: #e8f0fe;
        }
        
        .reviewer-id {
            color: #5f6368;
            font-family: monospace;
            background: #f1f3f4;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
        }
        
        .reviewer-status {
            font-weight: 500;
        }
        
        .reviewer-status.completed {
            color: #137333;
        }
        
        .reviewer-status.in-review {
            color: #1a73e8;
        }
        
        .reviewer-status.invited {
            color: #b0741e;
        }
        
        .reviewer-date {
            color: #5f6368;
            font-size: 11px;
        }
    `;
    
    document.head.appendChild(style);
}

// === 初始化监控面板功能 ===
function initializeMonitorPanel(data) {
    const panel = document.querySelector('.monitor-panel');
    const minimizeBtn = panel.querySelector('.minimize-btn');
    const startBtn = panel.querySelector('#monitor-start');
    const stopBtn = panel.querySelector('#monitor-stop');
    
    // 最小化/展开功能
    minimizeBtn.addEventListener('click', () => {
        panel.classList.toggle('minimized');
        minimizeBtn.textContent = panel.classList.contains('minimized') ? '+' : '_';
    });
    
    // 加载保存的邮箱
    chrome.storage.local.get('savedEmail', (data) => {
        if (data.savedEmail) {
            panel.querySelector('#monitor-email').value = data.savedEmail;
        }
    });
    
    // 开始监控按钮事件
    startBtn.addEventListener('click', () => {
        const email = panel.querySelector('#monitor-email').value;
        const interval = panel.querySelector('#monitor-interval').value;
        
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('请输入有效的邮箱地址！');
            return;
        }
        
        // 保存邮箱
        chrome.storage.local.set({ savedEmail: email });
        
        // 发送消息给background script
        chrome.runtime.sendMessage({
            type: 'START_MONITOR',
            url: window.location.href,
            email: email,
            interval: parseInt(interval),
            title: data.ManuscriptTitle || '未知标题'  // 直接传递标题
        }, response => {
            if (response && response.success) {
                startBtn.disabled = true;
                stopBtn.disabled = false;
                alert('监控已成功启动！您将通过邮件接收状态变更通知。');
            } else {
                alert(response?.error || '启动监控失败，请稍后重试');
            }
        });
    });
    
    // 停止监控按钮事件
    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
            type: 'STOP_MONITOR',
            url: window.location.href
        }, response => {
            if (response && response.success) {
                startBtn.disabled = false;
                stopBtn.disabled = true;
                alert('监控已停止！');
            } else {
                alert('停止监控失败，请稍后重试');
            }
        });
    });
    
    // 检查当前URL是否已在监控中
    chrome.runtime.sendMessage({
        type: 'CHECK_MONITORING',
        url: window.location.href
    }, response => {
        if (response && response.isMonitoring) {
            startBtn.disabled = true;
            stopBtn.disabled = false;
        }
    });
}

// 添加一个新函数，用于渲染详细的审稿人卡片
function renderDetailedReviewerCards(reviewers) {
    // 如果已存在，则先移除
    let existingCards = document.querySelector('.reviewer-cards-container');
    if (existingCards) {
        existingCards.remove();
    }
    
    // 创建容器
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'reviewer-cards-container';
    
    // 添加标题和统计信息
    const stats = {
        total: reviewers.length,
        completed: reviewers.filter(r => r.Status === 'Completed').length,
        inReview: reviewers.filter(r => r.Status === 'In Review').length,
        invited: reviewers.filter(r => r.Status === 'Invited').length
    };
    
    cardsContainer.innerHTML = `
        <div class="cards-header">
            <h2 class="cards-title">审稿人详细状态</h2>
            <div class="cards-stats">
                <span class="stat-badge completed">已完成: ${stats.completed}</span>
                <span class="stat-badge in-review">审稿中: ${stats.inReview + stats.completed}</span>
                <span class="stat-badge invited">已邀请: ${stats.invited + stats.inReview + stats.completed}</span>
            </div>
        </div>
        <div class="cards-grid"></div>
    `;
    
    // 添加卡片到网格
    const cardsGrid = cardsContainer.querySelector('.cards-grid');
    
    reviewers.forEach(reviewer => {
        const statusConfig = {
            'Completed': {
                icon: '✅',
                color: '#34a853',
                bgColor: '#e6f4ea',
                text: '已完成审稿'
            },
            'In Review': {
                icon: '🔍',
                color: '#4285f4',
                bgColor: '#e8f0fe',
                text: '正在审稿'
            },
            'Invited': {
                icon: '⏳',
                color: '#fbbc05',
                bgColor: '#fef7e0',
                text: '已邀请'
            }
        }[reviewer.Status];
        
        const card = document.createElement('div');
        card.className = `reviewer-card status-${reviewer.Status.toLowerCase().replace(' ', '-')}`;
        card.style.borderColor = statusConfig.color;
        card.style.backgroundColor = statusConfig.bgColor;
        
        // 计算时间
        const responseTime = reviewer.ResponseTime ? `${reviewer.ResponseTime} 天` : '进行中';
        const reviewTime = reviewer.ReviewTime ? `${reviewer.ReviewTime} 天` : '进行中';
        
        card.innerHTML = `
            <div class="card-header" style="color: ${statusConfig.color}">
                <span class="reviewer-number">#${reviewer.Id}</span>
                <span class="reviewer-status-badge">
                    ${statusConfig.icon} ${statusConfig.text}
                </span>
            </div>
            <div class="card-body">
                <div class="timeline">
                    <div class="timeline-item ${reviewer.InvitedDate ? 'completed' : ''}">
                        <div class="timeline-icon">📨</div>
                        <div class="timeline-content">
                            <div class="timeline-title">邀请审稿</div>
                            <div class="timeline-date">${formatDateTime(reviewer.InvitedDate)}</div>
                        </div>
                    </div>
                    <div class="timeline-item ${reviewer.AcceptedDate ? 'completed' : ''}">
                        <div class="timeline-icon">👍</div>
                        <div class="timeline-content">
                            <div class="timeline-title">接受邀请</div>
                            <div class="timeline-date">${formatDateTime(reviewer.AcceptedDate)}</div>
                        </div>
                    </div>
                    <div class="timeline-item ${reviewer.CompletedDate ? 'completed' : ''}">
                        <div class="timeline-icon">✅</div>
                        <div class="timeline-content">
                            <div class="timeline-title">完成审稿</div>
                            <div class="timeline-date">${formatDateTime(reviewer.CompletedDate)}</div>
                        </div>
                    </div>
                </div>
                <div class="time-stats">
                    <div class="time-stat">
                        <div class="stat-label">响应时间</div>
                        <div class="stat-value">${responseTime}</div>
                    </div>
                    <div class="time-stat">
                        <div class="stat-label">审稿时间</div>
                        <div class="stat-value">${reviewTime}</div>
                    </div>
                </div>
            </div>
        `;
        
        cardsGrid.appendChild(card);
    });
    
    // 将容器添加到页面
    document.body.appendChild(cardsContainer);
    
    // 添加或更新样式
    let style = document.getElementById('reviewer-cards-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'reviewer-cards-styles';
        document.head.appendChild(style);
    }
    
    style.textContent = `
        .reviewer-cards-container {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
            z-index: 10001;
            max-width: 90vw;
            max-height: 90vh;
            overflow-y: auto;
            width: 1000px;
        }
        
        .cards-header {
            position: sticky;
            top: 0;
            background: white;
            padding: 10px 0;
            margin-bottom: 20px;
            border-bottom: 1px solid #e0e0e0;
            z-index: 1;
        }
        
        .cards-title {
            font-size: 18px;
            color: #202124;
            margin: 0 0 10px 0;
        }
        
        .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            padding: 10px 0;
        }
        
        .reviewer-card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            transition: all 0.3s ease;
        }
        
        .reviewer-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .card-header {
            padding: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        .reviewer-number {
            font-size: 16px;
            font-weight: 600;
        }
        
        .reviewer-status-badge {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            font-weight: 500;
        }
        
        .timeline {
            padding: 15px;
        }
        
        .timeline-item {
            display: flex;
            gap: 10px;
            margin-bottom: 12px;
            opacity: 0.5;
        }
        
        .timeline-item.completed {
            opacity: 1;
        }
        
        .timeline-icon {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f1f3f4;
            border-radius: 50%;
        }
        
        .timeline-content {
            flex: 1;
        }
        
        .timeline-title {
            font-size: 13px;
            font-weight: 500;
            color: #202124;
        }
        
        .timeline-date {
            font-size: 12px;
            color: #5f6368;
            margin-top: 2px;
        }
        
        .time-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            padding: 15px;
            background: #f8f9fa;
        }
        
        .time-stat {
            text-align: center;
        }
        
        .stat-label {
            font-size: 12px;
            color: #5f6368;
            margin-bottom: 4px;
        }
        
        .stat-value {
            font-size: 14px;
            font-weight: 500;
            color: #202124;
        }
        
        /* 添加遮罩层 */
        .reviewer-cards-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
        }
    `;
    
    // 添加遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'reviewer-cards-overlay';
    document.body.appendChild(overlay);
    
    // 点击遮罩层关闭详细视图
    overlay.onclick = () => {
        cardsContainer.remove();
        overlay.remove();
        const detailButton = document.querySelector('.show-detailed-view');
        if (detailButton) {
            detailButton.textContent = '📊 查看详细审稿状态';
        }
    };
}

// 其他辅助函数...
