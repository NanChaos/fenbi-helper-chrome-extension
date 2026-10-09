/**
 * 后台服务：
 * 1) 点扩展图标 → 打开侧边栏（而不是弹窗）
 * 2) 侧边栏对所有标签页可用（切换标签页不关闭）
 */

chrome.runtime.onInstalled.addListener(function () {
  // 点图标直接开侧边栏
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
  }
});

chrome.runtime.onStartup.addListener(function () {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
  }
});

// 全局可用：不绑定具体 tab，切换标签页时侧边栏保持
chrome.sidePanel
  .setOptions({
    enabled: true,
    path: 'panel/panel.html',
  })
  .catch(function () {});
