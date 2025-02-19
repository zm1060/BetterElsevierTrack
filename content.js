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
    const map = {};
  
    events.forEach(ev => {
      const rid = ev.Id;
      if (!map[rid]) {
        map[rid] = {
          Id: rid,
          InvitedDate: null,
          AcceptedDate: null,
          CompletedDate: null,
          ResponseTime: null, // days
          ReviewTime: null,   // days
          // Status 不在此处设定，待所有事件处理后统一判断
        };
      }
      const reviewer = map[rid];
  
      switch (ev.Event) {
        case 'REVIEWER_INVITED':
          reviewer.InvitedDate = ev.Date;
          break;
        case 'REVIEWER_ACCEPTED':
          reviewer.AcceptedDate = ev.Date;
          // 计算响应时间 (Accepted - Invited)
          reviewer.ResponseTime = calcDaysDiff(reviewer.InvitedDate, reviewer.AcceptedDate);
          break;
        case 'REVIEWER_COMPLETED':
          reviewer.CompletedDate = ev.Date;
          // 计算审稿时间 (Completed - Accepted)
          reviewer.ReviewTime = calcDaysDiff(reviewer.AcceptedDate, reviewer.CompletedDate);
          break;
        default:
          break;
      }
    });
  
    // 根据事件状态，统一设置 Status 字段
    Object.values(map).forEach(r => {
      if (!r.AcceptedDate) {
        r.Status = 'Not accepted';
      } else if (r.AcceptedDate && !r.CompletedDate) {
        r.Status = 'In Review';
      } else if (r.CompletedDate) {
        r.Status = 'Completed';
      }
    });
  
    return Object.values(map);
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
  
    // 清除已有内容（如果存在）
    const existingDetails = document.querySelector('.submission-details');
    if (existingDetails) {
      existingDetails.remove();
    }
  
    // 聚合审稿人数据
    const reviewers = aggregateReviewers(data.ReviewEvents);
  
    // 按状态排序，优先显示 Completed 和 In Review
    reviewers.sort((a, b) => {
        if (a.Status === 'Completed' && b.Status !== 'Completed') return -1;
        if (a.Status === 'In Review' && b.Status !== 'In Review' && b.Status !== 'Completed') return -1;
        return 0; // 保持原有顺序
    });
  
    // 计算统计数据
    const stats = {
        completed: reviewers.filter(r => r.Status === 'Completed').length,
        accepted: reviewers.filter(r => r.AcceptedDate).length,
        invited: reviewers.length
    };
  
    // 生成页面结构
    const mainContent = document.createElement('div');
    mainContent.className = "submission-details";
    mainContent.style.margin = '20px 0';
  
    mainContent.innerHTML = `
      <h1 style="font-size: 24px; font-weight: bold; color: #007bff; margin-bottom: 10px;">
        ${data.ManuscriptTitle}
      </h1>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px;">
        <p><strong>Journal:</strong> ${data.JournalName} (${data.JournalAcronym})</p>
        <p><strong>Manuscript ID:</strong> ${data.PubdNumber}</p>
        <p><strong>First Author:</strong> ${data.FirstAuthor}</p>
        <p><strong>Corresponding Author:</strong> ${data.CorrespondingAuthor}</p>
        <p><strong>Submission Date:</strong> ${formatDateTime(data.SubmissionDate)}</p>
        <p><strong>Last Updated:</strong> ${formatDateTime(data.LastUpdated)}</p>
      </div>

      <!-- 添加统计数据 -->
      <div style="display: flex; justify-content: space-around; background-color: #f0f7ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: bold; color: #4CAF50;">${stats.completed}</div>
          <div style="color: #666;">Reviews completed</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: bold; color: #2196F3;">${stats.accepted}</div>
          <div style="color: #666;">Review invitations accepted</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: bold; color: #FFC107;">${stats.invited}</div>
          <div style="color: #666;">Review invitations sent</div>
        </div>
      </div>

      <h2 style="font-size: 20px; font-weight: bold; color: #333; margin-bottom: 15px;">
        Reviewers Acceptance and Review Time
      </h2>
      ${renderReviewersHTML(reviewers)}
    `;
  
    // 将生成的内容插入页面中
    const targetElement = document.querySelector('main') || document.body;
    targetElement.insertBefore(mainContent, targetElement.firstChild);
  }
  

// 在文件顶部添加消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('✅ Content script received message:', message);
    
    if (message.type === 'TRACKER_DATA' && message.data) {
        try {
            if (message.data.ManuscriptTitle && message.data.ReviewEvents) {
                console.log('✅ 收到有效数据，调用 renderPage');
                renderPage(message.data);
            } else {
                console.warn('⚠️ 收到的数据不符合要求:', message.data);
            }
        } catch (err) {
            console.error('❌ 处理消息数据时出错:', err);
        }
    }
    
    return true; // 保持消息通道开放
});
