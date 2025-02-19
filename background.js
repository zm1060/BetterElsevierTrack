chrome.webRequest.onCompleted.addListener(
    async (details) => {
        // 确保有 tabId 且为有效值
        if (details.url.includes('/tracker/') && details.tabId && details.tabId !== -1) {
            console.log('✅ Detected tracker API request:', {
                url: details.url,
                tabId: details.tabId
            });
            
            try {
                const response = await fetch(details.url);
                const data = await response.json();
                
                // 先检查 tab 是否存在
                const tab = await chrome.tabs.get(details.tabId).catch(() => null);
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
        urls: ["*://*/*tracker/*"]
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