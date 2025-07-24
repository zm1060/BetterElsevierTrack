// 添加 URL 处理函数
async function handleElsevierUrls(details) {
    // 如果已经是国际版 URL，直接返回
    if (details.url.includes('track.authorhub.elsevier.com')) {
        return details.url;
    }
    
    // 处理中国版 API URL
    if (details.url.includes('/detail?id=')) {
        console.log('✅ 检测到中国版 API URL，准备获取 UUID');
        
        try {
            const response = await fetch(details.url);
            const data = await response.json();
            
            if (data.success && data.result && data.result.uuid) {
                const uuid = data.result.uuid;
                const internationalUrl = `https://track.authorhub.elsevier.com/?uuid=${uuid}`;
                
                console.log('✅ 转换URL:', {
                    from: details.url,
                    to: internationalUrl,
                    uuid: uuid
                });
                
                // 自动重定向到国际版页面
                await chrome.tabs.update(details.tabId, { url: internationalUrl });
                return internationalUrl;
            }
        } catch (err) {
            console.error('❌ 获取 UUID 失败:', err);
        }
    }
    
    return details.url;
}

// 修改 webRequest 监听器
chrome.webRequest.onCompleted.addListener(
    async (details) => {
        // 匹配两种 URL 模式
        if ((details.url.includes('/tracker/') || details.url.includes('/detail?id=')) 
            && details.tabId && details.tabId !== -1) {
            
            console.log('✅ Detected API request:', {
                url: details.url,
                tabId: details.tabId
            });
            
            try {
                // 处理 URL 转换
                const apiUrl = await handleElsevierUrls(details);
                
                // 存储 API URL 映射
                const tab = await chrome.tabs.get(details.tabId).catch(() => null);
                if (tab) {
                    trackerApiUrls.set(tab.url, apiUrl);
                    console.log('✅ 已保存API URL映射:', {
                        pageUrl: tab.url,
                        apiUrl: apiUrl
                    });
                }
                
                // 获取数据
                const response = await fetch(apiUrl);
                const data = await response.json();
                
                if (!tab) {
                    console.warn('⚠️ Tab no longer exists:', details.tabId);
                    return;
                }

                // 发送数据给 content script
                await chrome.tabs.sendMessage(details.tabId, {
                    type: 'TRACKER_DATA',
                    data: data
                }).catch(err => {
                    console.warn('⚠️ Failed to send message to content script:', err);
                });
                
            } catch (err) {
                console.error('❌ Error fetching data:', {
                    error: err,
                    url: details.url,
                    tabId: details.tabId
                });
            }
        }
    },
    {
        urls: [
            "*://*/*tracker/*",
            "*://*/st/site/manuscript/v2/detail*"  // 添加中国版 API URL 匹配
        ]
    }
);

// 添加错误处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('✅ Received message in background:', {
        message,
        sender
    });
    return true; // 保持消息通道开放
});

// 监控任务管理
let monitoringTasks = new Map();
let notificationCounts = new Map();

// 存储最近拦截到的API URL
let trackerApiUrls = new Map();

// 辅助函数：获取页面URL对应的API URL
function getLastTrackerApiUrl(pageUrl) {
    const apiUrl = trackerApiUrls.get(pageUrl);
    console.log('✅ 查找API URL:', {
        pageUrl: pageUrl,
        foundApiUrl: apiUrl || '未找到'
    });
    return apiUrl;
}

// 修改 startMonitoring 函数
async function startMonitoring(url, pageUrl, email, interval, title) {
    try {
        // 确保我们使用的是API URL而不是页面URL
        // 这是关键修复 - 确保发送到服务器的是API URL
        console.log('✅ 开始监控:', {
            apiUrl: url,
            pageUrl: pageUrl,
            email: email
        });
        
        const serverResponse = await fetch('http://39.100.82.229:5000/start_monitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                url: url,  // 这应该是API URL
                pageUrl: pageUrl,  // 添加页面URL
                email: email,
                interval: interval,
                title: title
            })
        });
        
        if (!serverResponse.ok) {
            throw new Error('服务器返回错误: ' + (serverResponse.status));
        }

        const data = await serverResponse.json();
        
        // 存储监控信息，同时保存API URL和页面URL
        monitoringTasks.set(url, {
            taskId: data.task_id,
            email: email,
            pageUrl: pageUrl,  // 保存页面URL
            startTime: new Date()
        });
        
        // 重置重连计数
        serverReconnectAttempts = 0;
        
        return {
            success: true,
            taskId: data.task_id
        };
    } catch (err) {
        console.error('❌ 请求监控服务失败:', err);
        
        // 如果是连接错误，尝试重连
        if (err.message.includes('Failed to fetch') || 
            err.message.includes('NetworkError')) {
            attemptServerReconnect();
        }
        
        return {
            success: false,
            error: err.message || '未知错误'
        };
    }
}

// 停止监控
async function stopMonitoring(url) {
    try {
        const taskInfo = monitoringTasks.get(url);
        if (!taskInfo) {
            throw new Error('未找到监控任务');
        }
        
        console.log('正在停止监控任务:', {
            url: url,
            taskInfo: taskInfo
        });
        
        const response = await fetch('http://39.100.82.229:5000/stop_monitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                task_id: taskInfo.taskId || `${url}_${taskInfo.email}` 
            })
        });
        
        const responseData = await response.text();
        console.log('服务器响应:', responseData);
        
        if (!response.ok) {
            throw new Error('服务器返回错误: ' + response.status + ' - ' + responseData);
        }
        
        // 清理存储
        monitoringTasks.delete(url);
        await chrome.storage.local.remove(`monitor_${url}`);
        
        return { success: true };
    } catch (err) {
        console.error('❌ 停止监控失败:', err);
        return {
            success: false,
            error: err.message
        };
    }
}

// 美化通知函数
function createRichNotification(title, message, paperData) {
    // 创建通知选项
    const options = {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message,
        contextMessage: paperData.JournalName || '论文审稿状态更新',
        buttons: [
            { title: '查看详情' },
            { title: '忽略' }
        ],
        priority: 2
    };
    
    // 创建通知
    chrome.notifications.create(`paper_update_${Date.now()}`, options);
}

// 修改 handleUpdateNotification 函数
async function handleUpdateNotification(url, newData) {
    const taskInfo = monitoringTasks.get(url);
    if (!taskInfo) return;
    
    // 更新通知计数
    const count = (notificationCounts.get(url) || 0) + 1;
    notificationCounts.set(url, count);
    
    // 更新任务信息中的论文数据
    taskInfo.paperData = newData;
    
    // 生成更友好的消息
    const title = '论文审稿状态更新';
    const message = `${newData.ManuscriptTitle.substring(0, 50)}${newData.ManuscriptTitle.length > 50 ? '...' : ''} 有新的审稿状态更新`;
    
    // 使用富通知
    createRichNotification(title, message, newData);
    
    // 向popup发送更新消息
    chrome.runtime.sendMessage({
        type: 'UPDATE_NOTIFICATION_COUNT',
        count: count
    });
    
    chrome.runtime.sendMessage({
        type: 'UPDATE_PAPER_DATA',
        data: newData
    });
}

// 添加通知点击事件监听
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId.startsWith('paper_update_') && buttonIndex === 0) {
        // 查看详情按钮被点击
        // 查找相关的任务并打开页面
        for (const [url, taskInfo] of monitoringTasks.entries()) {
            if (taskInfo.paperData) {
                chrome.tabs.create({ url: taskInfo.pageUrl });
                break;
            }
        }
    }
    
    // 关闭通知
    chrome.notifications.clear(notificationId);
});

// 修改消息监听器
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_MONITOR') {
        // 获取API URL - 这是关键修复
        const apiUrl = getLastTrackerApiUrl(message.url);
        
        if (!apiUrl) {
            console.error('❌ 未找到API URL，无法启动监控:', message.url);
            sendResponse({ 
                success: false, 
                error: '未找到API URL，请刷新页面后重试' 
            });
            return true;
        }
        
        console.log('✅ 使用API URL进行监控:', apiUrl);
        
        // 使用API URL而不是页面URL进行监控
        startMonitoring(apiUrl, message.url, message.email, message.interval, message.title)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    } 
    else if (message.type === 'STOP_MONITOR') {
        // 获取最近拦截到的API URL
        const apiUrl = getLastTrackerApiUrl(message.url);
        
        if (!apiUrl) {
            console.error('❌ 未找到API URL，无法停止监控:', message.url);
            sendResponse({ 
                success: false, 
                error: '未找到API URL，请刷新页面后重试' 
            });
            return true;
        }
        
        console.log('✅ 使用API URL停止监控:', apiUrl);
        
        stopMonitoring(apiUrl)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }
    else if (message.type === 'CHECK_MONITORING') {
        // 获取最近拦截到的API URL
        const apiUrl = getLastTrackerApiUrl(message.url);
        const isMonitoring = apiUrl ? monitoringTasks.has(apiUrl) : false;
        
        sendResponse({ 
            isMonitoring: isMonitoring,
            taskInfo: isMonitoring ? monitoringTasks.get(apiUrl) : null
        });
        return true;
    }
    else if (message.type === 'GET_MONITORING_STATS') {
        // 获取监控统计信息
        const stats = getMonitoringStats();
        sendResponse({ success: true, stats: stats });
        return true;
    }
    else if (message.type === 'STOP_ALL_MONITORING') {
        // 停止所有监控
        stopAllMonitoring()
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ 
                success: false, 
                error: err.message 
            }));
        return true;
    }
    else if (message.type === 'CHECK_SERVER_HEALTH') {
        // 检查服务器健康状态
        checkServerHealth()
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ 
                healthy: false, 
                error: err.message 
            }));
        return true;
    }
    else if (message.type === 'GET_HISTORICAL_DATA') {
        const history = getHistoricalData();
        sendResponse({ success: true, history: history });
        return true;
    }
    return true;
});

// 初始化时加载已有的监控任务
chrome.storage.local.get(null, (items) => {
    Object.keys(items).forEach(key => {
        if (key.startsWith('monitor_')) {
            const url = key.replace('monitor_', '');
            const taskInfo = items[key];
            monitoringTasks.set(url, taskInfo);
        }
    });
});

// 添加定时自动保存监控任务到 storage
function saveMonitoringTasksToStorage() {
    monitoringTasks.forEach((taskInfo, url) => {
        chrome.storage.local.set({
            [`monitor_${url}`]: taskInfo
        });
    });
    console.log('✅ 已保存所有监控任务到 storage');
}

// 定期保存监控任务状态
setInterval(saveMonitoringTasksToStorage, 60000); // 每分钟保存一次

// 添加监控统计功能
function getMonitoringStats() {
    const stats = {
        total: monitoringTasks.size,
        byJournal: {},
        oldestTask: null,
        newestTask: null
    };
    
    if (monitoringTasks.size === 0) return stats;
    
    let oldestTime = Date.now();
    let newestTime = 0;
    
    monitoringTasks.forEach((taskInfo, url) => {
        // 统计期刊分布
        const journal = taskInfo.paperData?.JournalName || '未知期刊';
        stats.byJournal[journal] = (stats.byJournal[journal] || 0) + 1;
        
        // 查找最早和最新的任务
        const startTime = new Date(taskInfo.startTime).getTime();
        if (startTime < oldestTime) {
            oldestTime = startTime;
            stats.oldestTask = {
                url: url,
                title: taskInfo.paperData?.ManuscriptTitle || '未知标题',
                startTime: taskInfo.startTime
            };
        }
        
        if (startTime > newestTime) {
            newestTime = startTime;
            stats.newestTask = {
                url: url,
                title: taskInfo.paperData?.ManuscriptTitle || '未知标题',
                startTime: taskInfo.startTime
            };
        }
    });
    
    return stats;
}

// 添加批量操作功能
async function stopAllMonitoring() {
    const urls = Array.from(monitoringTasks.keys());
    const results = [];
    
    for (const url of urls) {
        try {
            const result = await stopMonitoring(url);
            results.push({ url, success: result.success });
        } catch (err) {
            results.push({ url, success: false, error: err.message });
        }
    }
    
    return {
        totalStopped: results.filter(r => r.success).length,
        totalFailed: results.filter(r => !r.success).length,
        details: results
    };
}

// 添加健康检查功能
async function checkServerHealth() {
    try {
        const response = await fetch('http://39.100.82.229:5000/health', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            return { 
                healthy: false, 
                error: `服务器返回错误: ${response.status}` 
            };
        }
        
        const data = await response.json();
        return { 
            healthy: true, 
            serverInfo: data 
        };
    } catch (err) {
        return { 
            healthy: false, 
            error: err.message || '无法连接到监控服务器' 
        };
    }
}

// 添加自动重连机制
let serverReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function attemptServerReconnect() {
    if (serverReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('❌ 达到最大重连次数，停止尝试');
        return;
    }
    
    serverReconnectAttempts++;
    console.log(`⚠️ 尝试重连监控服务器 (${serverReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    
    const health = await checkServerHealth();
    if (health.healthy) {
        console.log('✅ 服务器重连成功');
        serverReconnectAttempts = 0;
        
        // 重新启动所有监控任务
        monitoringTasks.forEach((taskInfo, url) => {
            startMonitoring(
                url, 
                taskInfo.pageUrl, 
                taskInfo.email, 
                taskInfo.interval || 3600, 
                taskInfo.paperData?.ManuscriptTitle || '未知标题'
            ).then(result => {
                console.log(`✅ 重新启动监控任务: ${result.success ? '成功' : '失败'}`);
            });
        });
    } else {
        console.error('❌ 服务器重连失败:', health.error);
        // 稍后再试
        setTimeout(attemptServerReconnect, 60000 * serverReconnectAttempts); // 逐渐增加重试间隔
    }
}

// 添加数据同步功能
async function syncMonitoringData() {
    for (const [url, taskInfo] of monitoringTasks.entries()) {
        try {
            // 获取最新数据
            const response = await fetch(url);
            if (!response.ok) continue;
            
            const data = await response.json();
            
            // 更新任务信息
            taskInfo.paperData = data;
            
            // 检查是否有更新
            if (taskInfo.lastUpdated !== data.LastUpdated) {
                taskInfo.lastUpdated = data.LastUpdated;
                
                // 处理更新通知
                handleUpdateNotification(url, data);
            }
        } catch (err) {
            console.error(`❌ 同步数据失败 (${url}):`, err);
        }
    }
}

// 定期同步数据
setInterval(syncMonitoringData, 30 * 60 * 1000); // 每30分钟同步一次

// 添加获取历史数据的函数
function getHistoricalData() {
    const history = [];
    
    monitoringTasks.forEach((taskInfo, url) => {
        if (taskInfo.paperData && taskInfo.paperData.ReviewEvents) {
            // 提取审稿事件历史
            const events = taskInfo.paperData.ReviewEvents.map(event => ({
                date: new Date(event.Date * 1000),
                type: event.Event,
                reviewerId: event.Id,
                paperTitle: taskInfo.paperData.ManuscriptTitle,
                journal: taskInfo.paperData.JournalName
            }));
            
            history.push(...events);
        }
    });
    
    // 按日期排序
    return history.sort((a, b) => a.date - b.date);
}