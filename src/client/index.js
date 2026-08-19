(function registerContextGraphClient() {
  window.__ModuleLoader__.load({
    id: 'dsh-context-graph',
    factory: require => {
const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = require('react');
const styles = String.raw`
.cg-root{--cg-line:#e5e7eb;--cg-muted:#6b7280;--cg-text:#171717;--cg-bg:#fff;--cg-soft:#f7f7f8;--cg-accent:#2563eb;display:grid;grid-template-rows:48px minmax(0,1fr) auto;height:100%;min-width:0;background:var(--cg-bg);color:var(--cg-text);font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}
.cg-root *{box-sizing:border-box;letter-spacing:0}.cg-header{display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--cg-line);min-width:0}.cg-title{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:auto}.cg-search{width:150px;min-width:70px;border:1px solid var(--cg-line);border-radius:5px;background:var(--cg-bg);color:var(--cg-text);font:inherit;padding:5px 7px}.cg-filter{max-width:120px;border:1px solid var(--cg-line);border-radius:5px;background:var(--cg-bg);color:var(--cg-text);font:inherit;padding:5px}.cg-icon{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:#52525b;font-size:16px;cursor:pointer}.cg-icon:hover{background:#f1f1f2;color:#18181b}.cg-icon:disabled{opacity:.4;cursor:default}.cg-canvas-wrap{position:relative;min-height:0;overflow:hidden;background-color:#fafafa;background-image:radial-gradient(#d6d6d8 1px,transparent 1px);background-size:18px 18px}.cg-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}.cg-canvas[data-dragging=true]{cursor:grabbing}.cg-edge{fill:none;stroke:#a1a1aa;stroke-width:1.7}.cg-edge[data-type=interface],.cg-edge[data-type=affects],.cg-edge[data-type=targets]{stroke:#3b82f6}.cg-edge[data-type=dependency],.cg-edge[data-type=depends_on]{stroke:#d97706}.cg-edge[data-type=data],.cg-edge[data-type=constrains]{stroke:#8b5cf6}.cg-edge[data-type=optional]{stroke-dasharray:6 5}.cg-edge[data-type=conflicts_with]{stroke:#dc2626;stroke-dasharray:4 3}.cg-edge[data-selected=true]{stroke:#111827;stroke-width:3}.cg-edge-hit{fill:none;stroke:transparent;stroke-width:13;cursor:pointer}.cg-temp{fill:none;stroke:#2563eb;stroke-width:2;stroke-dasharray:5 4}.cg-node{cursor:move}.cg-node-box{fill:white;stroke:#d4d4d8;stroke-width:1}.cg-node[data-selected=true] .cg-node-box{stroke:#2563eb;stroke-width:2}.cg-node[data-mode=FORCE_INCLUDE] .cg-node-box{stroke:#16a34a}.cg-node[data-mode=FORCE_EXCLUDE] .cg-node-box{stroke:#dc2626}.cg-node-head{fill:#f4f4f5}.cg-node[data-node-type=requirement] .cg-node-head{fill:#dbeafe}.cg-node[data-node-type=constraint] .cg-node-head{fill:#ede9fe}.cg-node[data-node-type=decision] .cg-node-head{fill:#dcfce7}.cg-node[data-node-type=task] .cg-node-head{fill:#fef3c7}.cg-node[data-node-type=issue] .cg-node-head{fill:#fee2e2}.cg-node-title{font-size:12px;font-weight:650;fill:#18181b;pointer-events:none}.cg-node-meta{font-size:10px;fill:#71717a;pointer-events:none}.cg-port{fill:#fff;stroke:#71717a;stroke-width:2;cursor:crosshair}.cg-port:hover{fill:#2563eb;stroke:#2563eb}.cg-tools{position:absolute;left:8px;top:8px;display:flex;gap:3px;padding:3px;background:#ffffffeb;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 2px 8px #0000000d}.cg-status{position:absolute;left:9px;bottom:8px;max-width:calc(100% - 18px);padding:4px 7px;border:1px solid var(--cg-line);border-radius:4px;background:#ffffffeb;color:var(--cg-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-status[data-error=true]{color:#b91c1c}.cg-empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--cg-muted);pointer-events:none}.cg-empty strong{color:#3f3f46;margin-bottom:4px}.cg-inspector{position:absolute;left:8px;right:8px;bottom:35px;max-height:48%;overflow:auto;background:#fff;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 8px 24px #00000014}.cg-inspector-head{display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid var(--cg-line);font-weight:650}.cg-inspector-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:auto}.cg-form{padding:8px 10px}.cg-form label{display:block;margin:7px 0 3px;color:var(--cg-muted);font-size:11px}.cg-form input,.cg-form select,.cg-form textarea,.cg-compose textarea,.cg-compose select{width:100%;border:1px solid #d4d4d8;border-radius:5px;background:#fff;color:#18181b;font:inherit;padding:7px 8px;outline:none}.cg-form textarea{min-height:72px;resize:vertical}.cg-form input:focus,.cg-form select:focus,.cg-form textarea:focus,.cg-compose textarea:focus,.cg-compose select:focus{border-color:#60a5fa;box-shadow:0 0 0 2px #dbeafe}.cg-checks{display:flex;flex-wrap:wrap;gap:5px 9px}.cg-checks label{display:flex;align-items:center;gap:4px;margin:3px 0;color:#3f3f46}.cg-checks input{width:auto;box-shadow:none}.cg-row{display:flex;gap:6px}.cg-row>*{min-width:0;flex:1}.cg-danger{margin-top:8px;border:0;background:transparent;color:#dc2626;padding:5px 0;cursor:pointer}.cg-compose{padding:9px 10px 10px;border-top:1px solid var(--cg-line);background:#fff}.cg-compose-top{display:flex;gap:6px;margin-bottom:6px}.cg-compose-top select{flex:1}.cg-target{flex:1;min-width:0;color:var(--cg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:center;font-size:11px}.cg-compose textarea{display:block;min-height:62px;max-height:140px;resize:vertical;padding-right:38px}.cg-textarea-wrap{position:relative}.cg-send{position:absolute;right:6px;bottom:6px;width:28px;height:28px;border:0;border-radius:5px;background:#18181b;color:#fff;cursor:pointer}.cg-send:disabled{opacity:.35;cursor:default}.cg-help{position:absolute;inset:12px;z-index:4;background:#fff;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 12px 34px #0002;padding:13px;overflow:auto}.cg-help h3{font-size:14px;margin:0 0 10px}.cg-help dl{display:grid;grid-template-columns:auto 1fr;gap:7px 12px;margin:0}.cg-help dt{font-family:ui-monospace,monospace;color:#18181b}.cg-help dd{margin:0;color:var(--cg-muted)}.cg-launcher{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:inherit;font-size:15px;cursor:pointer}.cg-launcher:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.cg-context-anchor{display:inline-flex;align-items:center;flex:0 0 auto;min-width:0}.cg-context-button{border:0;background:transparent;color:#374151;font:inherit;font-weight:500;padding:5px 7px;border-radius:5px;cursor:pointer;white-space:nowrap}.cg-context-button:hover,.cg-context-button[aria-expanded=true]{background:#f3f4f6;color:#111827}.cg-context-menu{position:fixed!important;z-index:50;width:324px!important;min-width:0!important;max-width:calc(100vw - 24px)!important;height:auto!important;max-height:calc(100vh - 24px)!important;overflow:auto!important;padding:12px!important;background:#fff!important;color:#1f2937!important;border:1px solid #e5e7eb!important;border-radius:8px!important;box-shadow:0 12px 30px rgb(15 23 42 / 14%)!important;font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif!important}.cg-context-menu label{display:block!important;margin:0 0 5px!important;font-size:12px!important;font-weight:500!important;line-height:17px!important;color:#6b7280!important}.cg-context-menu select,.cg-context-menu textarea{box-sizing:border-box!important;width:100%!important;margin:0!important;border:1px solid #d1d5db!important;border-radius:6px!important;background:#fff!important;color:#1f2937!important;padding:8px 9px!important;font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif!important;outline:none!important}.cg-context-menu select{display:block!important;height:36px!important;min-height:36px!important}.cg-context-menu textarea{display:block!important;height:96px!important;min-height:96px!important;max-height:144px!important;resize:vertical!important;line-height:1.5!important}.cg-context-menu select:focus,.cg-context-menu textarea:focus{border-color:#60a5fa!important;box-shadow:0 0 0 3px #dbeafe!important}.cg-context-target{display:flex!important;align-items:center!important;min-height:28px!important;margin:10px 0 12px!important;padding:5px 8px!important;border-radius:5px!important;background:#f8fafc!important;color:#64748b!important;font-size:12px!important;line-height:18px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.cg-context-menu button{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:32px!important;margin:10px 0 0!important;border:0!important;border-radius:6px!important;padding:7px 10px!important;background:#2563eb!important;color:#fff!important;font:500 13px/18px Inter,ui-sans-serif,system-ui,sans-serif!important;cursor:pointer!important}.cg-context-menu button:hover{background:#1d4ed8!important}
body[data-ds-dark-theme] .cg-root{--cg-line:#34343a;--cg-muted:#a1a1aa;--cg-text:#f4f4f5;--cg-bg:#18181b;--cg-soft:#27272a}body[data-ds-dark-theme] .cg-canvas-wrap{background-color:#1c1c1f;background-image:radial-gradient(#3f3f46 1px,transparent 1px)}body[data-ds-dark-theme] .cg-node-box,body[data-ds-dark-theme] .cg-form input,body[data-ds-dark-theme] .cg-form select,body[data-ds-dark-theme] .cg-compose textarea,body[data-ds-dark-theme] .cg-compose select{fill:#202023;background:#202023;color:#f4f4f5;border-color:#3f3f46}body[data-ds-dark-theme] .cg-node-head{fill:#2b2b30}body[data-ds-dark-theme] .cg-node-title{fill:#f4f4f5}body[data-ds-dark-theme] .cg-node-meta{fill:#a1a1aa}body[data-ds-dark-theme] .cg-tools,body[data-ds-dark-theme] .cg-status,body[data-ds-dark-theme] .cg-inspector,body[data-ds-dark-theme] .cg-help{background:#202023eb;border-color:#3f3f46}body[data-ds-dark-theme] .cg-icon{color:#d4d4d8}body[data-ds-dark-theme] .cg-context-button{color:#d4d4d8}body[data-ds-dark-theme] .cg-context-button:hover,body[data-ds-dark-theme] .cg-context-button[aria-expanded=true]{background:#2b2b30;color:#fff}body[data-ds-dark-theme] .cg-context-menu{background:#202023!important;color:#f4f4f5!important;border-color:#3f3f46!important;box-shadow:0 12px 30px #0006!important}body[data-ds-dark-theme] .cg-context-menu label{color:#a1a1aa!important}body[data-ds-dark-theme] .cg-context-menu select,body[data-ds-dark-theme] .cg-context-menu textarea{background:#27272a!important;color:#f4f4f5!important;border-color:#48484f!important}body[data-ds-dark-theme] .cg-context-target{background:#29292e!important;color:#c4c4cc!important}body[data-ds-dark-theme] .cg-form textarea{background:#202023;color:#f4f4f5;border-color:#3f3f46}.cg-help dd{white-space:pre-wrap}.cg-node[data-node-type=functional] .cg-node-head{fill:#cffafe}.cg-context-check{display:flex!important;align-items:center!important;gap:7px!important;margin:0 0 9px!important;color:#374151!important;font-size:13px!important}.cg-context-check input{width:auto!important;margin:0!important;accent-color:#2563eb}body[data-ds-dark-theme] .cg-context-check{color:#e4e4e7!important}.cg-preview-heading{margin:14px 0 5px!important}.cg-preview-list{display:grid;gap:4px}.cg-preview-list>div{display:flex;align-items:center;gap:5px;min-width:0;color:var(--cg-muted);font-size:12px}.cg-preview-list span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-preview-list .cg-icon{width:24px;height:24px;margin-left:auto;font-size:14px;flex:0 0 auto}
`;

const TASK_WORKFLOW_STYLES = String.raw`
.cg-header{position:relative;z-index:5}.cg-node-menu-anchor{position:relative;display:inline-flex}.cg-node-menu{position:absolute;right:0;top:34px;z-index:10;display:grid;min-width:132px;padding:4px;background:#fff;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 10px 24px #00000018}.cg-node-menu-item{border:0;border-radius:4px;background:transparent;color:#27272a;padding:6px 8px;text-align:left;font:inherit;cursor:pointer}.cg-node-menu-item:hover{background:#f4f4f5;color:#111827}.cg-context-menu button:disabled{opacity:.55!important;cursor:default!important}.cg-context-actions{display:flex!important;gap:7px!important;margin-top:10px!important}.cg-context-menu .cg-context-actions button{flex:1!important;margin:0!important}.cg-context-menu button.cg-context-secondary{background:#f3f4f6!important;color:#374151!important}.cg-context-menu button.cg-context-secondary:hover{background:#e5e7eb!important}.cg-context-message{margin:8px 0 0!important;color:#64748b!important;font-size:12px!important;line-height:17px!important}.cg-context-message[data-error=true]{color:#b91c1c!important}.cg-context-divider{height:1px!important;margin:14px 0!important;background:#e5e7eb!important}.cg-canvas,.cg-canvas *{user-select:none;-webkit-user-select:none}
body[data-ds-dark-theme] .cg-node-menu{background:#202023;border-color:#3f3f46;box-shadow:0 10px 24px #0008}body[data-ds-dark-theme] .cg-node-menu-item{color:#e4e4e7}body[data-ds-dark-theme] .cg-node-menu-item:hover{background:#2b2b30;color:#fff}body[data-ds-dark-theme] .cg-context-menu button.cg-context-secondary{background:#303036!important;color:#e4e4e7!important}body[data-ds-dark-theme] .cg-context-menu button.cg-context-secondary:hover{background:#3b3b42!important}body[data-ds-dark-theme] .cg-context-divider{background:#3f3f46!important}
.cg-side-panel{position:absolute;z-index:6;top:12px;right:12px;bottom:12px;width:min(420px,calc(100% - 24px));display:flex;flex-direction:column;overflow:hidden;background:var(--cg-bg);color:var(--cg-text);border:1px solid var(--cg-line);border-radius:8px;box-shadow:0 12px 34px #0002}.cg-side-panel button:focus-visible{outline:2px solid #60a5fa;outline-offset:1px}.cg-panel-head{display:flex;align-items:center;gap:10px;min-height:58px;padding:9px 10px 9px 12px;border-bottom:1px solid var(--cg-line);background:var(--cg-bg);flex:0 0 auto}.cg-panel-heading{min-width:0;flex:1}.cg-panel-kicker{display:block;color:var(--cg-muted);font-size:10px;line-height:15px}.cg-panel-title{display:block;font-size:14px;font-weight:650;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-panel-subtitle{display:block;margin-top:1px;color:var(--cg-muted);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-panel-head>.cg-icon{flex:0 0 auto}.cg-panel-body{flex:1;min-height:0;overflow:auto;padding:12px}.cg-panel-actions{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--cg-line);background:var(--cg-bg);flex:0 0 auto}.cg-panel-button{min-width:76px;height:32px;border:1px solid transparent;border-radius:6px;padding:0 12px;font:500 13px/30px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer}.cg-panel-button:disabled{opacity:.45;cursor:default}.cg-panel-primary{background:var(--cg-accent);color:#fff}.cg-panel-primary:hover:not(:disabled){background:#1d4ed8}.cg-panel-secondary{border-color:var(--cg-line);background:var(--cg-bg);color:var(--cg-text)}.cg-panel-secondary:hover{background:var(--cg-soft)}.cg-preview-summary{padding-bottom:12px;border-bottom:1px solid var(--cg-line)}.cg-summary-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.cg-summary-label{color:var(--cg-muted);font-size:12px}.cg-summary-value{font-size:13px;font-weight:650;white-space:nowrap}.cg-preview-summary[data-over=true] .cg-summary-value{color:#dc2626}.cg-budget-bar{height:5px;margin-top:8px;overflow:hidden;border-radius:3px;background:var(--cg-soft)}.cg-budget-bar>span{display:block;height:100%;border-radius:inherit;background:var(--cg-accent);transition:width .18s ease}.cg-budget-bar[data-over=true]>span{background:#dc2626}.cg-budget-caption{display:block;margin-top:5px;color:var(--cg-muted);font-size:11px}.cg-panel-section{margin-top:16px}.cg-panel-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}.cg-panel-section-title{margin:0;font-size:12px;font-weight:650}.cg-panel-count{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;padding:0 6px;border-radius:5px;background:var(--cg-soft);color:var(--cg-muted);font-size:10px}.cg-panel-task{margin:0;color:var(--cg-text);font-size:12px;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}.cg-context-list,.cg-proposal-list{display:grid}.cg-context-item{display:flex;align-items:center;gap:8px;min-width:0;padding:9px 0;border-bottom:1px solid var(--cg-line)}.cg-context-item:last-child,.cg-proposal-item:last-child{border-bottom:0}.cg-context-item-main{min-width:0;flex:1}.cg-context-item-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:550}.cg-context-item-meta,.cg-context-item-reason{display:block;margin-top:2px;color:var(--cg-muted);font-size:11px;line-height:15px;overflow-wrap:anywhere}.cg-context-item>.cg-icon{width:26px;height:26px;flex:0 0 auto;font-size:14px}.cg-panel-empty{padding:10px 0;color:var(--cg-muted);font-size:12px}.cg-proposal-summary{display:flex;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--cg-line);color:var(--cg-muted);font-size:12px}.cg-proposal-summary strong{color:var(--cg-text);font-size:13px}.cg-proposal-summary-separator{color:var(--cg-line)}.cg-proposal-item{padding:11px 0;border-bottom:1px solid var(--cg-line)}.cg-proposal-item-head{display:flex;align-items:baseline;gap:8px;min-width:0}.cg-proposal-item-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:650}.cg-proposal-item-count{flex:0 0 auto;color:var(--cg-muted);font-size:11px}.cg-proposal-paths{display:grid;gap:3px;margin-top:6px}.cg-proposal-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cg-muted);font:11px/16px ui-monospace,SFMono-Regular,Consolas,monospace}.cg-proposal-confidence{margin-top:5px;color:var(--cg-muted);font-size:10px}.cg-panel-warning{margin:10px 0 0;padding:8px 9px;border-left:2px solid #d97706;background:var(--cg-soft);color:var(--cg-muted);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.cg-level-filter{max-width:88px}.cg-node-expand{cursor:pointer}.cg-node-expand rect{fill:var(--cg-bg);stroke:var(--cg-line)}.cg-node-expand text{fill:var(--cg-muted);font-size:13px;font-weight:650;pointer-events:none}.cg-node-expand:hover rect{stroke:var(--cg-accent)}.cg-node-expand:hover text{fill:var(--cg-accent)}
.cg-node[data-status=stale]{opacity:.62}.cg-node[data-status=stale] .cg-node-box{stroke-dasharray:5 3}.cg-edge[data-stale=true]{opacity:.48;stroke-dasharray:5 4}
.cg-action-required{margin-top:8px;padding:8px 9px;border-left:2px solid #dc2626;background:var(--cg-soft);font-size:11px;line-height:16px}.cg-action-required>strong{display:block}.cg-action-required-item>span{display:block;margin-top:3px;color:var(--cg-muted);overflow-wrap:anywhere}.cg-action-options{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.cg-action-options span{padding:2px 5px;border:1px solid var(--cg-line);border-radius:4px;color:var(--cg-text);font-size:10px}
.cg-audit-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin-top:8px}.cg-audit-cell{min-width:0;padding:7px 5px;border:1px solid var(--cg-line);border-radius:5px;background:var(--cg-soft);text-align:center}.cg-audit-label{display:block;color:var(--cg-muted);font-size:9px;line-height:13px}.cg-audit-value{display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:650;white-space:nowrap}.cg-validation{display:flex;align-items:flex-start;gap:8px;margin-top:9px;padding:8px 9px;border:1px solid var(--cg-line);border-radius:5px;background:var(--cg-soft)}.cg-validation-mark{flex:0 0 auto;color:#71717a;font-weight:700}.cg-validation[data-status=valid] .cg-validation-mark{color:#15803d}.cg-validation[data-status=invalid] .cg-validation-mark{color:#dc2626}.cg-validation-main{min-width:0}.cg-validation-title{display:block;font-size:11px;font-weight:650}.cg-validation-issue{display:block;margin-top:2px;color:var(--cg-muted);font-size:10px;line-height:14px;overflow-wrap:anywhere}.cg-context-item-fields{display:flex;flex-wrap:wrap;gap:3px 8px;margin-top:3px;color:var(--cg-muted);font-size:10px;line-height:14px}.cg-context-item-fields span{min-width:0;overflow-wrap:anywhere}.cg-context-item-fields strong{color:var(--cg-text);font-weight:550}.cg-context-item[data-policy=hard]{border-left:2px solid #dc2626;padding-left:7px}.cg-context-item[data-policy=optional]{opacity:.82}
body[data-ds-dark-theme] .cg-side-panel,body[data-ds-dark-theme] .cg-panel-head,body[data-ds-dark-theme] .cg-panel-actions{background:#202023;border-color:#3f3f46}body[data-ds-dark-theme] .cg-panel-secondary{background:#202023;border-color:#48484f;color:#f4f4f5}body[data-ds-dark-theme] .cg-panel-secondary:hover,body[data-ds-dark-theme] .cg-side-panel .cg-icon:hover{background:#2b2b30;color:#fff}body[data-ds-dark-theme] .cg-panel-primary{background:#3b82f6}body[data-ds-dark-theme] .cg-panel-primary:hover:not(:disabled){background:#2563eb}body[data-ds-dark-theme] .cg-preview-summary,body[data-ds-dark-theme] .cg-context-item,body[data-ds-dark-theme] .cg-proposal-summary,body[data-ds-dark-theme] .cg-proposal-item{border-color:#3f3f46}body[data-ds-dark-theme] .cg-panel-count,body[data-ds-dark-theme] .cg-budget-bar,body[data-ds-dark-theme] .cg-panel-warning{background:#2b2b30}
@media(max-width:780px){.cg-header{gap:2px;padding:0 5px;overflow-x:auto;scrollbar-width:none}.cg-header::-webkit-scrollbar{display:none}.cg-title,.cg-search{display:none}.cg-filter{max-width:88px}.cg-icon{width:28px}}
@media(max-width:560px){.cg-type-filter{display:none}.cg-side-panel{top:8px;right:8px;bottom:8px;left:8px;width:auto}.cg-panel-actions{padding-bottom:max(10px,env(safe-area-inset-bottom))}.cg-audit-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

const API = '/context-graph/api';
const TYPES = ['provides', 'consumes', 'depends_on', 'produces', 'affects', 'constrains', 'implements', 'feeds', 'transforms', 'triggers', 'related_to', 'targets', 'requires', 'constrained_by', 'applies_to', 'interface', 'implemented_by', 'derived_from', 'conflicts_with', 'supersedes', 'contains', 'uses', 'tests', 'documents', 'force_include', 'force_exclude'];
const MODES = ['AUTO', 'MANUAL', 'FORCE_INCLUDE', 'FORCE_EXCLUDE'];
const SCOPES = ['code', 'context', 'interface', 'contract', 'state', 'decisions', 'history', 'content'];
const NODE_TYPES = ['functional', 'code_module', 'implementation_file', 'implementation_class', 'implementation_function', 'implementation_package', 'implementation_symbol', 'requirement', 'task', 'constraint', 'decision', 'interface', 'documentation', 'conversation', 'artifact', 'test', 'issue', 'note', 'project_rule'];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];
const STATUSES = ['active', 'resolved', 'deprecated', 'superseded', 'archived', 'stale'];
const TASKS = [['develop', '开发'], ['debug', '调试'], ['refactor', '重构'], ['test', '测试'], ['review', '审查'], ['docs', '文档']];
const CREATE_NODE_TYPES = [['functional', '功能', '新建功能'], ['task', '任务', '新建任务'], ['requirement', '需求', '新建需求'], ['constraint', '约束', '新建约束'], ['decision', '决策', '新建决策'], ['issue', '问题', '新建问题'], ['note', '备注', '新建备注']];
const CONTEXT_BUDGETS = [2000, 4000, 6000, 8000, 12000, 16000];
const DEFAULT_SESSION_CONTEXT = { autoInject: false, tokenBudget: 6000, reuseContext: true, maxImplementationFiles: 2, semanticDepth: 2, include: [], exclude: [] };
const IMPLEMENTATION_LEVELS = [['0', '文件'], ['1', '类'], ['2', '函数'], ['3', '符号']];
const IMPLEMENTATION_TYPES = new Set(['code_module', 'implementation_file', 'implementation_class', 'implementation_function', 'implementation_package', 'implementation_symbol']);
const NODE_W = 178;
const NODE_H = 88;
const DOUBLE_PRESS_MS = 360;

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function edgePath(source, target) {
  const x1 = source.x + NODE_W;
  const y1 = source.y + NODE_H / 2;
  const x2 = target.x;
  const y2 = target.y + NODE_H / 2;
  const bend = Math.max(45, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function graphPoint(svg, view, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
}

function truncateNodeText(value, maxWidth, fontSize) {
  const text = String(value || '');
  let width = 0;
  let output = '';
  for (const character of [...text]) {
    const characterWidth = character.codePointAt(0) > 255 ? fontSize : fontSize * 0.56;
    if (width + characterWidth + fontSize > maxWidth) return `${output}…`;
    output += character;
    width += characterWidth;
  }
  return output;
}

function isImplementationNode(node) {
  return IMPLEMENTATION_TYPES.has(node?.type || 'code_module');
}

function implementationLevel(node) {
  if (node?.type === 'implementation_class') return 1;
  if (node?.type === 'implementation_function') return 2;
  if (node?.type === 'implementation_symbol') return 3;
  return 0;
}

function buildImplementationHierarchy(graph) {
  const implementation = (graph?.nodes || []).filter(isImplementationNode);
  const nodeMap = new Map(implementation.map(node => [node.id, node]));
  const parents = new Map();
  const setParent = (child, parent) => {
    if (child !== parent && nodeMap.has(child) && nodeMap.has(parent) && !parents.has(child)) parents.set(child, parent);
  };
  for (const edge of graph?.edges || []) if (edge.type === 'contains') setParent(edge.target, edge.source);
  for (const node of implementation) {
    const metadata = node.metadata || {};
    const explicit = metadata.parentId || metadata.parent_id || metadata.parent || metadata.containerId || metadata.container_id || metadata.container || metadata.owner;
    if (typeof explicit === 'string') setParent(node.id, explicit);
  }
  for (const node of implementation) {
    if (parents.has(node.id) || implementationLevel(node) === 0) continue;
    const lower = implementation.filter(candidate => candidate.id !== node.id && implementationLevel(candidate) < implementationLevel(node));
    const prefixed = lower.filter(candidate => node.id.startsWith(`${candidate.id}.`) || node.id.startsWith(`${candidate.id}:`) || node.id.startsWith(`${candidate.id}#`)).sort((left, right) => right.id.length - left.id.length);
    const samePath = lower.filter(candidate => node.path && candidate.path === node.path);
    const deepest = samePath.length ? Math.max(...samePath.map(implementationLevel)) : -1;
    const deepestCandidates = samePath.filter(candidate => implementationLevel(candidate) === deepest);
    const fileCandidates = samePath.filter(candidate => implementationLevel(candidate) === 0);
    const parent = prefixed[0] || (deepestCandidates.length === 1 ? deepestCandidates[0] : fileCandidates.length === 1 ? fileCandidates[0] : null);
    if (parent) setParent(node.id, parent.id);
  }
  const children = new Map(implementation.map(node => [node.id, []]));
  for (const [child, parent] of parents) children.get(parent)?.push(child);
  const ancestorsOf = id => {
    const result = [];
    const seen = new Set([id]);
    let current = parents.get(id);
    while (current && !seen.has(current)) { result.push(current); seen.add(current); current = parents.get(current); }
    return result;
  };
  const descendantsOf = id => {
    const result = [];
    const queue = [...(children.get(id) || [])];
    const seen = new Set();
    while (queue.length) { const current = queue.shift(); if (seen.has(current)) continue; seen.add(current); result.push(current); queue.push(...(children.get(current) || [])); }
    return result;
  };
  return { parents, children, ancestorsOf, descendantsOf };
}

function containedImplementationDescendants(graph, id) {
  const implementation = new Set((graph?.nodes || []).filter(isImplementationNode).map(node => node.id));
  const children = new Map();
  for (const edge of graph?.edges || []) {
    if (edge.type !== 'contains' || !implementation.has(edge.source) || !implementation.has(edge.target)) continue;
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source).push(edge.target);
  }
  const result = [];
  const seen = new Set([id]);
  const queue = [...(children.get(id) || [])];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    queue.push(...(children.get(current) || []));
  }
  return result;
}

function normalizeManifestItem(item) {
  return typeof item === 'string' ? { node: item, module: item } : item || {};
}

function contextManifest(data = {}) {
  const manifest = data.manifest && typeof data.manifest === 'object' ? data.manifest : {};
  return {
    manifest,
    included: (manifest.included || data.included || []).map(normalizeManifestItem),
    excluded: (manifest.excluded || data.excluded || []).map(normalizeManifestItem),
    audit: { ...data, ...manifest, ...(data.audit || {}), ...(manifest.audit || {}) },
    validation: data.audit?.validation ?? manifest.validation ?? data.validation,
  };
}

function tokenMetric(audit, aliases, fallback = null) {
  for (const key of aliases) {
    const value = audit?.[key];
    if ((typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))) return Math.max(0, Number(value));
    if (value && Number.isFinite(Number(value.tokens))) return Math.max(0, Number(value.tokens));
  }
  return fallback;
}

function manifestAudit(data, included, excluded, audit) {
  const selectedFallback = Number.isFinite(Number(data.estimatedTokens)) ? Math.max(0, Number(data.estimatedTokens)) : null;
  const selected = tokenMetric(audit, ['selectedTokens', 'selected_tokens', 'selectedContextTokens', 'selected_context_tokens', 'selected'], selectedFallback);
  const excludedFallback = excluded.some(item => Number.isFinite(Number(item.tokens))) ? excluded.reduce((sum, item) => sum + (Number(item.tokens) || 0), 0) : null;
  const excludedTokens = tokenMetric(audit, ['excludedTokens', 'excluded_tokens', 'excludedContextTokens', 'excluded_context_tokens', 'excluded'], excludedFallback);
  return {
    raw: tokenMetric(audit, ['rawTokens', 'raw_tokens', 'rawContextTokens', 'raw_context_tokens', 'totalRawTokens', 'total_raw_tokens', 'raw']),
    candidate: tokenMetric(audit, ['candidateTokens', 'candidate_tokens', 'candidateContextTokens', 'candidate_context_tokens', 'candidate'], selected !== null && excludedTokens !== null ? selected + excludedTokens : null),
    selected,
    excluded: excludedTokens,
    final: tokenMetric(audit, ['finalEstimatedTotalTokens', 'final_estimated_total_tokens', 'finalTokens', 'final_tokens', 'finalRequestTokens', 'final_request_tokens', 'final']),
  };
}

function validationSummary(value, overBudget) {
  if (typeof value === 'boolean') return { status: value ? 'valid' : 'invalid', label: value ? '验证通过' : '验证失败', issues: [] };
  if (value && typeof value === 'object') {
    const errors = value.errors || value.issues || value.violations || [];
    const warnings = value.warnings || [];
    const normalizedErrors = Array.isArray(errors) ? errors : [String(errors)];
    const normalizedWarnings = (Array.isArray(warnings) ? warnings : [String(warnings)]).map(item => typeof item === 'string' ? `警告：${item}` : { ...item, message: `警告：${item.message || item.reason || JSON.stringify(item)}` });
    const passed = value.valid ?? value.passed ?? value.ok ?? (normalizedErrors.length ? false : typeof value.status === 'string' ? /^(valid|passed|ok)$/i.test(value.status) : undefined);
    return { status: passed === true ? 'valid' : passed === false ? 'invalid' : 'unknown', label: passed === true ? '验证通过' : passed === false ? '验证失败' : '尚未验证', issues: [...normalizedErrors, ...normalizedWarnings] };
  }
  if (overBudget) return { status: 'invalid', label: '预算验证失败', issues: ['最终上下文超过预算'] };
  return { status: 'unknown', label: '尚未验证', issues: [] };
}

function displaySource(source) {
  if (!source) return 'unknown';
  if (typeof source === 'string') return source;
  return source.id || source.kind || source.type || 'structured';
}

function displayPolicyClass(value) {
  const normalized = String(value || 'soft').toLowerCase();
  if (normalized === 'hard') return 'Hard';
  if (normalized === 'optional') return 'Optional';
  return normalized === 'soft' ? 'Soft' : value;
}

function displayScore(value) {
  if (!Number.isFinite(Number(value))) return '未评分';
  const score = Number(value);
  return score >= 0 && score <= 1 ? `${Math.round(score * 100)}%` : score.toFixed(2);
}

function displayValidationIssue(issue) {
  if (typeof issue === 'string') return issue;
  const prefix = [issue?.code, issue?.node].filter(Boolean).join(' · ');
  const detail = issue?.message || issue?.reason || JSON.stringify(issue);
  return prefix ? `${prefix}：${detail}` : detail;
}

function displayActionOption(option) {
  const id = typeof option === 'string' ? option : option?.id;
  if (id === 'remove_exclusion_and_retry') return '解除排除并重试';
  if (id === 'keep_exclusion_and_cancel') return '保留排除并取消任务';
  return typeof option === 'string' ? option : option?.label || option?.id || '确认处理';
}

function displayActionMessage(action) {
  const nodes = (action?.nodes || action?.candidates || []).join('、');
  if (action?.type === 'resolve_force_exclude_hard_conflict') return `Force Exclude 与必要的 Hard Context 冲突：${nodes}。请选择解除排除后重试，或保留排除并取消当前任务。`;
  if (action?.type === 'resolve_force_exclude_target_conflict') return `当前目标已被 Force Exclude：${nodes}。请选择解除排除后重试，或保留排除并取消当前任务。`;
  if (action?.type === 'clarify_force_exclude_target') return `排除目标存在同名节点，请选择精确节点：${nodes}。`;
  return action?.message || '上下文排除与当前任务冲突。';
}

function autoLayout(graph) {
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  }
  const levels = new Map();
  const queue = [];
  const seed = id => {
    if (levels.has(id)) return;
    levels.set(id, 0);
    queue.push(id);
  };
  for (const node of graph.nodes) if (incoming.get(node.id) === 0) seed(node.id);
  while (levels.size < graph.nodes.length) {
    while (queue.length) {
      const id = queue.shift();
      for (const target of outgoing.get(id)) {
        if (levels.has(target)) continue;
        levels.set(target, (levels.get(id) || 0) + 1);
        queue.push(target);
      }
    }
    const next = graph.nodes.find(node => !levels.has(node.id));
    if (!next) break;
    seed(next.id);
  }
  const buckets = new Map();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) || 0;
    const bucket = buckets.get(level) || [];
    bucket.push(node.id);
    buckets.set(level, bucket);
  }
  return { ...graph, nodes: graph.nodes.map(node => {
    const level = levels.get(node.id) || 0;
    const bucket = buckets.get(level);
    const index = bucket.indexOf(node.id);
    const rowsPerColumn = Math.max(1, Math.floor(Math.sqrt(bucket.length)));
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    return { ...node, x: 36 + (level + column) * 245, y: 52 + row * 126 };
  }) };
}

function fitView(graph, width, height) {
  if (!graph.nodes.length) return { x: 0, y: 0, zoom: 1 };
  const xs = graph.nodes.map(node => Number(node.x) || 0);
  const ys = graph.nodes.map(node => Number(node.y) || 0);
  const minX = Math.min(...xs); const maxX = Math.max(...xs) + NODE_W;
  const minY = Math.min(...ys); const maxY = Math.max(...ys) + NODE_H;
  const zoom = Math.min(1.2, Math.max(.3, Math.min((width - 40) / (maxX - minX), (height - 40) / (maxY - minY))));
  return { zoom, x: (width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (height - (maxY - minY) * zoom) / 2 - minY * zoom };
}

function IconButton({ label, children, onClick, disabled }) {
  return h('button', { className: 'cg-icon', type: 'button', title: label, 'aria-label': label, onClick, disabled }, children);
}

function Checks({ value = [], onChange }) {
  return h('div', { className: 'cg-checks' }, SCOPES.map(scope => h('label', { key: scope },
    h('input', { type: 'checkbox', checked: value.includes(scope), onChange: event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope)) }), scope)));
}

function ContextCommand({ sessionId, projectPath, inputActions, targetStore, sendPrompt }) {
  const [open, setOpen] = useState(false);
  const [taskType, setTaskType] = useState('develop');
  const [task, setTask] = useState('');
  const [target, setTarget] = useState(() => targetStore.get(sessionId));
  const [taskTargets, setTaskTargets] = useState([]);
  const [chosenTarget, setChosenTarget] = useState('');
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetLoadError, setTargetLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [taskMessage, setTaskMessage] = useState('');
  const [taskFailed, setTaskFailed] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SESSION_CONTEXT);
  const anchorRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => targetStore.subscribe(sessionId, setTarget), [sessionId, targetStore]);
  useEffect(() => {
    let active = true;
    if (!projectPath) return undefined;
    request(`/session-settings?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`).then(value => { if (active) setSettings(value); }).catch(() => {});
    return () => { active = false; };
  }, [projectPath, sessionId]);
  useEffect(() => {
    setChosenTarget('');
    setTaskTargets([]);
  }, [projectPath, sessionId]);
  useEffect(() => {
    if (!open || !projectPath) return undefined;
    let active = true;
    setTargetsLoading(true);
    setTargetLoadError('');
    request(`/graph?project=${encodeURIComponent(projectPath)}`).then(graph => {
      if (!active) return;
      const functional = (graph.nodes || []).filter(node => node.type === 'functional');
      setTaskTargets(functional);
      setChosenTarget(current => functional.some(node => node.id === current) ? current : '');
    }).catch(cause => {
      if (!active) return;
      setTaskTargets([]);
      setTargetLoadError(`无法加载功能节点：${cause.message}`);
    }).finally(() => { if (active) setTargetsLoading(false); });
    return () => { active = false; };
  }, [open, projectPath]);
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = event => { if (!anchorRef.current?.contains(event.target)) setOpen(false); };
    const keydown = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', keydown); };
  }, [open]);

  const updateSettings = async patch => {
    if (!projectPath) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    try { setSettings(await request('/session-settings', { method: 'POST', body: JSON.stringify({ projectPath, sessionId, ...patch }) })); }
    catch { setSettings(settings); }
  };
  const taskLabel = TASKS.find(([key]) => key === taskType)?.[1] || taskType;
  const addToDraft = () => {
    const content = task.trim();
    if (!content) { setTaskFailed(true); setTaskMessage('请先填写任务内容'); return; }
    const draftTarget = chosenTarget || target;
    inputActions.setDraft(`任务类型：${taskLabel}${draftTarget ? `\n目标模块：${draftTarget}` : ''}\n\n${content}`);
    setTaskMessage('');
    setTaskFailed(false);
    setOpen(false);
  };
  const createTaskAndSend = async () => {
    const content = task.trim();
    if (!content || creating) {
      if (!content) { setTaskFailed(true); setTaskMessage('请先填写任务内容'); }
      return;
    }
    if (!projectPath) { setTaskFailed(true); setTaskMessage('当前会话没有工作区'); return; }
    let persisted = false;
    setCreating(true);
    setTaskMessage('');
    setTaskFailed(false);
    try {
      const created = await request('/tasks', { method: 'POST', body: JSON.stringify({ projectPath, sessionId, content, taskType, target: chosenTarget || undefined }) });
      if (!created.task?.id) throw new Error('服务未返回新建任务');
      persisted = true;
      targetStore.set(sessionId, created.task.id);
      // Task creation is the explicit opt-in boundary for Context Graph
      // injection. Restore the session's previous setting after this turn.
      const wasAutoInject = settings.autoInject === true;
      if (!wasAutoInject) await updateSettings({ autoInject: true });
      try {
        await sendPrompt(`任务类型：${taskLabel}\n目标模块：${created.target || '自动识别'}\n\n${content}`);
      } finally {
        if (!wasAutoInject) await updateSettings({ autoInject: false });
      }
      setTask('');
      setOpen(false);
    } catch (cause) {
      setTaskFailed(true);
      setTaskMessage(persisted ? `任务已创建，但发送失败：${cause.message}` : cause.message);
    } finally {
      setCreating(false);
    }
  };

  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const budgetOptions = CONTEXT_BUDGETS.includes(settings.tokenBudget) ? CONTEXT_BUDGETS : [...CONTEXT_BUDGETS, settings.tokenBudget].sort((left, right) => left - right);
  const message = taskMessage || targetLoadError;
  const messageError = taskFailed || Boolean(targetLoadError);
  return h('span', { ref: anchorRef, className: 'cg-context-anchor' },
    h('button', { ref: buttonRef, type: 'button', className: 'cg-context-button', title: '上下文任务', 'aria-expanded': open, onClick: () => { setTaskMessage(''); setTaskFailed(false); setOpen(value => !value); } }, '上下文'),
    open && rect ? h('div', { className: 'cg-context-menu', role: 'dialog', 'aria-label': '上下文任务', style: { left: Math.max(12, Math.min(rect.left, window.innerWidth - 336)), bottom: window.innerHeight - rect.top + 8 } },
      h('label', null, '任务类型'),
      h('select', { value: taskType, onChange: event => setTaskType(event.target.value) }, TASKS.map(([key, label]) => h('option', { key, value: key }, label))),
      h('label', null, '目标功能'),
      h('select', { value: chosenTarget, onChange: event => setChosenTarget(event.target.value), disabled: targetsLoading },
        h('option', { value: '' }, targetsLoading ? '正在加载功能…' : '自动识别功能'),
        taskTargets.map(node => h('option', { key: node.id, value: node.id }, node.title || node.label || node.id))),
      h('label', null, '任务内容'),
      h('textarea', { value: task, placeholder: '描述需要完成的工作', onChange: event => { setTask(event.target.value); setTaskMessage(''); setTaskFailed(false); } }),
      message ? h('div', { className: 'cg-context-message', 'data-error': messageError }, message) : null,
      h('div', { className: 'cg-context-actions' },
        h('button', { className: 'cg-context-secondary', type: 'button', disabled: !task.trim() || creating, onClick: addToDraft }, '添加到输入框'),
        h('button', { className: 'cg-context-primary', type: 'button', disabled: !task.trim() || creating, onClick: () => void createTaskAndSend() }, creating ? '正在创建…' : '创建任务并发送')),
      h('div', { className: 'cg-context-divider' }),
      h('label', { className: 'cg-context-check' }, h('input', { type: 'checkbox', checked: settings.autoInject, onChange: event => void updateSettings({ autoInject: event.target.checked }) }), '自动注入当前会话'),
      h('label', null, '单轮上下文预算'),
      h('select', { value: settings.tokenBudget, onChange: event => void updateSettings({ tokenBudget: Number(event.target.value) }) }, budgetOptions.map(value => h('option', { key: value, value }, `${value} tokens`))),
      h('label', null, '相关实现文件'),
      h('select', { value: settings.maxImplementationFiles, onChange: event => void updateSettings({ maxImplementationFiles: Number(event.target.value) }) }, [1, 2, 3, 4, 5].map(value => h('option', { key: value, value }, `${value} 个`))),
      h('label', null, '语义关联层数'),
      h('select', { value: settings.semanticDepth, onChange: event => void updateSettings({ semanticDepth: Number(event.target.value) }) }, [1, 2, 3].map(value => h('option', { key: value, value }, `${value} 层`))),
      h('label', { className: 'cg-context-check' }, h('input', { type: 'checkbox', checked: settings.reuseContext, onChange: event => void updateSettings({ reuseContext: event.target.checked }) }), '复用未变化的上下文')) : null);
}

function Inspector({ graph, selected, updateNode, updateEdge, remove, showImplementation }) {
  const [position, setPosition] = useState(null);
  if (!selected) return null;
  const item = selected.kind === 'node' ? graph.nodes.find(node => node.id === selected.id) : graph.edges[selected.index];
  if (!item) return null;
  const title = selected.kind === 'node' ? (item.label || item.id) : `${item.source} → ${item.target}`;
  const implementations = selected.kind === 'node' && item.type === 'functional' ? (graph.mappings || []).filter(value => value.functional === item.id).flatMap(value => value.implementation || []) : [];
  const drag = event => { const start = { x: event.clientX, y: event.clientY, left: position?.left ?? event.currentTarget.parentElement.getBoundingClientRect().left, top: position?.top ?? event.currentTarget.parentElement.getBoundingClientRect().top }; const move = next => setPosition({ left: Math.max(8, start.left + next.clientX - start.x), top: Math.max(8, start.top + next.clientY - start.y) }); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); };
  return h('section', { className: 'cg-inspector', style: position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto', width: 300 } : undefined },
    h('div', { className: 'cg-inspector-head', onPointerDown: drag }, h('span', null, title)),
    h('div', { className: 'cg-form' }, selected.kind === 'node' ? [
      h('label', { key: 'lt' }, '标题'),
      h('input', { key: 't', value: item.title || item.label || '', onChange: event => updateNode({ title: event.target.value, label: event.target.value }) }),
      h('div', { className: 'cg-row', key: 'type-row' },
        h('div', null, h('label', null, '节点类型'), h('select', { value: item.type || 'code_module', onChange: event => updateNode({ type: event.target.value }) }, NODE_TYPES.map(type => h('option', { key: type }, type)))),
        h('div', null, h('label', null, '来源'), h('input', { value: item.source || '', onChange: event => updateNode({ source: event.target.value }) }))),
      h('label', { key: 'lc' }, '内容'),
      h('textarea', { key: 'c', value: item.content || '', onChange: event => updateNode({ content: event.target.value, description: event.target.value }) }),
      item.type === 'functional' ? h('div', { key: 'implementation' }, h('label', null, 'Implementation'), h('div', { className: 'cg-context-target' }, implementations.map(value => value.path || value.id).join(' · ') || '未映射'), h('button', { type: 'button', onClick: () => showImplementation(item.id) }, '查看实现')) : null,
      h('label', { key: 'lp' }, '模块路径'),
      h('input', { key: 'p', value: item.path || '', disabled: item.type !== 'code_module', onChange: event => updateNode({ path: event.target.value }) }),
      h('div', { className: 'cg-row', key: 'state-row' },
        h('div', null, h('label', null, '优先级'), h('select', { value: item.priority || 'normal', onChange: event => updateNode({ priority: event.target.value }) }, PRIORITIES.map(priority => h('option', { key: priority }, priority)))),
        h('div', null, h('label', null, '状态'), h('select', { value: item.status || 'active', onChange: event => updateNode({ status: event.target.value }) }, STATUSES.map(status => h('option', { key: status }, status))))),
      h('label', { key: 'lm' }, '上下文模式'), h('select', { key: 'm', value: item.mode || 'AUTO', onChange: event => updateNode({ mode: event.target.value }) }, MODES.map(mode => h('option', { key: mode }, mode))),
      h('label', { key: 'ls' }, '上下文范围'),
      h(Checks, { key: 's', value: item.scope || ['interface', 'state'], onChange: scope => updateNode({ scope }) }),
    ] : [
      h('div', { className: 'cg-row', key: 'row' },
        h('div', null, h('label', null, '关系类型'), h('select', { value: item.type, onChange: event => updateEdge({ type: event.target.value }) }, TYPES.map(type => h('option', { key: type }, type)))),
        h('div', null, h('label', null, '模式'), h('select', { value: item.mode || 'AUTO', onChange: event => updateEdge({ mode: event.target.value }) }, MODES.map(mode => h('option', { key: mode }, mode))))),
      h('label', { key: 'ls' }, '传递范围'),
      h(Checks, { key: 's', value: item.scope || [], onChange: scope => updateEdge({ scope }) }),
    ], h('button', { className: 'cg-danger', type: 'button', onClick: remove }, selected.kind === 'node' ? '删除节点' : '删除连接')));
}

function focusPanel(panel) {
  panel?.querySelector('button')?.focus({ preventScroll: true });
}

function usePanelFocus(updateKey) {
  const panelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    focusPanel(panelRef.current);
    return () => { if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (panelRef.current && !panelRef.current.contains(document.activeElement)) focusPanel(panelRef.current); }, [updateKey]);
  return panelRef;
}

function ContextPreviewPanel({ data, onClose, onForceExclude, onForceInclude }) {
  const panelRef = usePanelFocus(data);
  const { manifest, included, excluded, audit: rawAudit, validation: rawValidation } = contextManifest(data);
  const entryValue = data.entry || data.target || manifest.entry || manifest.task || '当前入口';
  const entry = typeof entryValue === 'string' ? entryValue : entryValue.id || entryValue.title || '当前入口';
  const sessionExcluded = new Set(data.sessionSettings?.exclude || []);
  const sessionIncluded = new Set(data.sessionSettings?.include || []);
  const audit = manifestAudit(data, included, excluded, rawAudit);
  const usedTokens = audit.selected ?? Math.max(0, Number(data.estimatedTokens) || 0);
  const tokenBudget = Math.max(0, Number(manifest.budget ?? data.tokenBudget) || 0);
  const budgetExceeded = Boolean(data.overBudget) || tokenBudget > 0 && usedTokens > tokenBudget;
  const validation = validationSummary(rawValidation, budgetExceeded);
  const actionRequired = Array.isArray(rawValidation?.actionRequired) ? rawValidation.actionRequired : rawValidation?.actionRequired ? [rawValidation.actionRequired] : [];
  const budgetPercent = tokenBudget ? Math.min(100, Math.round(usedTokens / tokenBudget * 100)) : 0;
  const auditCells = [['Raw', audit.raw], ['Candidate', audit.candidate], ['Selected', audit.selected], ['Excluded', audit.excluded], ['Final', audit.final]];
  const taskText = data.previewTask || (typeof manifest.task === 'string' ? manifest.task : manifest.task?.content || manifest.task?.title) || '无';
  const renderItem = (item, index, isExcluded) => {
    const id = item.node || item.module || item.id || '未知条目';
    const scopes = Array.isArray(item.scope) ? item.scope : item.scope ? [item.scope] : [];
    const scopeText = scopes.length ? scopes.join(' · ') : '未标注范围';
    const policyClass = item.policyClass ?? item.policy_class ?? item.contextClass ?? item.context_class ?? item.tier ?? 'soft';
    const source = item.source ?? item.provenance?.source;
    const score = item.score ?? item.relevanceScore ?? item.relevance_score;
    const reason = item.reason || manifest.reasons?.[id] || (isExcluded ? '未选择' : '自动选择');
    const canForceExclude = !isExcluded && id !== entry && !scopes.includes('task');
    const canForceInclude = isExcluded && id !== entry;
    return h('div', { className: 'cg-context-item', 'data-policy': String(policyClass).toLowerCase(), key: `${id}-${scopeText}-${index}` },
      h('div', { className: 'cg-context-item-main' },
        h('span', { className: 'cg-context-item-title', title: id }, id),
        h('span', { className: 'cg-context-item-meta' }, scopeText),
        h('div', { className: 'cg-context-item-fields' },
          h('span', null, h('strong', null, 'Class '), displayPolicyClass(policyClass)),
          h('span', null, h('strong', null, 'Score '), displayScore(score)),
          h('span', null, h('strong', null, 'Source '), displaySource(source)),
          h('span', null, h('strong', null, 'Tokens '), Number.isFinite(Number(item.tokens)) ? Number(item.tokens) : 0)),
        h('span', { className: 'cg-context-item-reason' }, `原因 · ${sessionExcluded.has(id) ? 'Force Exclude' : sessionIncluded.has(id) ? 'Force Include' : reason}`)),
      canForceExclude
        ? h(IconButton, { label: `强制排除 ${id}`, onClick: () => onForceExclude(id) }, '×')
        : canForceInclude
          ? h(IconButton, { label: `强制包含 ${id}`, onClick: () => onForceInclude(id) }, '+')
          : null);
  };

  return h('aside', { ref: panelRef, className: 'cg-side-panel cg-preview-panel', role: 'dialog', 'aria-label': '上下文预览' },
    h('header', { className: 'cg-panel-head' },
      h('div', { className: 'cg-panel-heading' },
        h('span', { className: 'cg-panel-kicker' }, 'Context Manifest'),
        h('strong', { className: 'cg-panel-title' }, '上下文预览与审计'),
        h('span', { className: 'cg-panel-subtitle', title: entry }, `入口 · ${entry}`)),
      h(IconButton, { label: '关闭上下文预览', onClick: onClose }, '×')),
    h('div', { className: 'cg-panel-body' },
      h('section', { className: 'cg-preview-summary', 'data-over': budgetExceeded },
        h('div', { className: 'cg-summary-row' },
          h('span', { className: 'cg-summary-label' }, '本轮上下文预算'),
          h('strong', { className: 'cg-summary-value' }, `${usedTokens} / ${tokenBudget} tokens`)),
        h('div', { className: 'cg-budget-bar', 'data-over': budgetExceeded, role: 'progressbar', 'aria-label': '上下文预算使用量', 'aria-valuemin': 0, 'aria-valuemax': tokenBudget, 'aria-valuenow': usedTokens },
          h('span', { style: { width: `${budgetPercent}%` } })),
        h('span', { className: 'cg-budget-caption' }, budgetExceeded ? '已超过预算，发送前验证应阻止请求' : `剩余 ${Math.max(0, tokenBudget - usedTokens)} tokens`),
        h('div', { className: 'cg-audit-grid', 'aria-label': 'Request Context Audit' }, auditCells.map(([label, value]) => h('div', { className: 'cg-audit-cell', key: label },
          h('span', { className: 'cg-audit-label' }, label),
          h('strong', { className: 'cg-audit-value', title: value === null ? '暂无数据' : `${value} tokens` }, value === null ? '—' : Math.round(value))))),
        h('div', { className: 'cg-validation', 'data-status': validation.status },
          h('span', { className: 'cg-validation-mark', 'aria-hidden': true }, validation.status === 'valid' ? '✓' : validation.status === 'invalid' ? '×' : '?'),
          h('div', { className: 'cg-validation-main' },
            h('strong', { className: 'cg-validation-title' }, validation.label),
            validation.issues.map((issue, index) => h('span', { className: 'cg-validation-issue', key: `${displayValidationIssue(issue)}-${index}` }, displayValidationIssue(issue))))),
        actionRequired.length ? h('div', { className: 'cg-action-required' },
          h('strong', null, '需要你的确认'),
          actionRequired.map((action, index) => h('div', { className: 'cg-action-required-item', key: `${action.type || 'action'}-${index}` },
            h('span', null, displayActionMessage(action)),
            h('div', { className: 'cg-action-options' }, (action.options || []).map(option => h('span', { key: typeof option === 'string' ? option : option.id }, displayActionOption(option))))))) : null
      ),
      h('section', { className: 'cg-panel-section' },
        h('div', { className: 'cg-panel-section-head' }, h('h3', { className: 'cg-panel-section-title' }, '当前任务')),
        h('p', { className: 'cg-panel-task' }, taskText)),
      h('section', { className: 'cg-panel-section' },
        h('div', { className: 'cg-panel-section-head' }, h('h3', { className: 'cg-panel-section-title' }, '已包含'), h('span', { className: 'cg-panel-count' }, included.length)),
        h('div', { className: 'cg-context-list' }, included.length ? included.map((item, index) => renderItem(item, index, false)) : h('span', { className: 'cg-panel-empty' }, '没有已包含内容'))),
      h('section', { className: 'cg-panel-section' },
        h('div', { className: 'cg-panel-section-head' }, h('h3', { className: 'cg-panel-section-title' }, '已排除'), h('span', { className: 'cg-panel-count' }, excluded.length)),
        h('div', { className: 'cg-context-list' }, excluded.length ? excluded.map((item, index) => renderItem(item, index, true)) : h('span', { className: 'cg-panel-empty' }, '没有已排除内容')))),
    h('footer', { className: 'cg-panel-actions' },
      h('button', { className: 'cg-panel-button cg-panel-secondary', type: 'button', onClick: onClose }, '关闭')));
}

function FunctionalProposalPanel({ proposal, graph, onClose, onConfirm }) {
  const panelRef = usePanelFocus(proposal);
  const nodes = Array.isArray(proposal.nodes) ? proposal.nodes : [];
  const updates = Array.isArray(proposal.updates) ? proposal.updates : [];
  const mappings = Array.isArray(proposal.mappings) ? proposal.mappings : [];
  const edges = Array.isArray(proposal.edges) ? proposal.edges : [];
  const warnings = Array.isArray(proposal.warnings) ? proposal.warnings : [];
  const knownNodes = new Map([...(graph?.nodes || []), ...nodes, ...updates].map(node => [node.id, node]));
  const proposalItems = [...new Set([...nodes.map(node => node.id), ...updates.map(node => node.id), ...mappings.map(mapping => mapping.functional)])]
    .map(id => knownNodes.get(id) || { id, title: id, label: id });
  const implementationCount = mappings.reduce((total, mapping) => total + (mapping.implementation?.length || 0), 0);
  const hasChanges = nodes.length > 0 || updates.length > 0 || mappings.length > 0 || edges.length > 0;

  return h('aside', { ref: panelRef, className: 'cg-side-panel cg-proposal-panel', role: 'dialog', 'aria-label': '功能模块推断' },
    h('header', { className: 'cg-panel-head' },
      h('div', { className: 'cg-panel-heading' },
        h('span', { className: 'cg-panel-kicker' }, 'Semantic Inference'),
        h('strong', { className: 'cg-panel-title' }, '功能模块推断'),
        h('span', { className: 'cg-panel-subtitle' }, '根据实现调用关系整理候选功能')),
      h(IconButton, { label: '关闭功能模块推断', onClick: onClose }, '×')),
    h('div', { className: 'cg-panel-body' },
      h('div', { className: 'cg-proposal-summary' },
        h('span', null, h('strong', null, nodes.length), ' 个新功能'),
        h('span', { className: 'cg-proposal-summary-separator' }, '|'),
        h('span', null, h('strong', null, updates.length), ' 个重新验证'),
        h('span', { className: 'cg-proposal-summary-separator' }, '|'),
        h('span', null, h('strong', null, implementationCount), ' 个实现映射')),
      warnings.map((warning, index) => h('p', { className: 'cg-panel-warning', key: `${warning}-${index}` }, warning)),
      h('section', { className: 'cg-panel-section' },
        h('div', { className: 'cg-panel-section-head' }, h('h3', { className: 'cg-panel-section-title' }, '功能与实现映射'), h('span', { className: 'cg-panel-count' }, proposalItems.length)),
        h('div', { className: 'cg-proposal-list' }, proposalItems.length ? proposalItems.map(node => {
          const mapping = mappings.find(item => item.functional === node.id);
          const implementations = Array.isArray(mapping?.implementation) ? mapping.implementation : [];
          const confidence = Number(mapping?.confidence);
          const isNew = nodes.some(item => item.id === node.id);
          const isUpdate = updates.some(item => item.id === node.id);
          return h('article', { className: 'cg-proposal-item', key: node.id },
            h('div', { className: 'cg-proposal-item-head' },
              h('strong', { className: 'cg-proposal-item-title', title: node.title || node.label || node.id }, node.title || node.label || node.id),
              h('span', { className: 'cg-proposal-item-count' }, `${isNew ? '新功能 · ' : isUpdate ? '重新验证 · ' : ''}${implementations.length} 个实现`)),
            h('span', { className: 'cg-context-item-reason', title: node.id }, node.id),
            h('div', { className: 'cg-proposal-paths' }, implementations.length
              ? implementations.map((item, index) => { const path = typeof item === 'string' ? item : item.path || item.id; return h('span', { className: 'cg-proposal-path', key: `${path}-${index}`, title: path }, path); })
              : h('span', { className: 'cg-panel-empty' }, '未找到实现文件')),
            Number.isFinite(confidence) ? h('div', { className: 'cg-proposal-confidence' }, `推断置信度 ${Math.round(confidence * 100)}%`) : null);
        }) : h('span', { className: 'cg-panel-empty' }, '没有可提议的功能模块')))),
    h('footer', { className: 'cg-panel-actions' },
      h('button', { className: 'cg-panel-button cg-panel-secondary', type: 'button', onClick: onClose }, '关闭'),
      h('button', { className: 'cg-panel-button cg-panel-primary', type: 'button', disabled: !hasChanges, onClick: onConfirm }, '确认加入图谱')));
}

function GraphPanel({ sessionId, projectPath, sendPrompt, setTarget }) {
  const [graph, setGraph] = useState(null);
  const [selected, setSelected] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [gesture, setGesture] = useState(null);
  const [status, setStatus] = useState('正在载入…');
  const [error, setError] = useState(false);
  const [task, setTask] = useState('');
  const [taskType, setTaskType] = useState('develop');
  const [sending, setSending] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [previewData, setPreviewData] = useState(null);
  const [viewMode, setViewMode] = useState('semantic');
  const [implementationFocus, setImplementationFocus] = useState(null);
  const [implementationDetail, setImplementationDetail] = useState('0');
  const [expandedImplementation, setExpandedImplementation] = useState(() => new Set());
  const [functionalProposal, setFunctionalProposal] = useState(null);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const svgRef = useRef(null);
  const nodeMenuRef = useRef(null);
  const overlayRequestRef = useRef(0);
  const graphRef = useRef(graph); graphRef.current = graph;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const pressRef = useRef({ key: '', time: 0 });

  const announce = useCallback((text, failed = false) => { setStatus(text); setError(failed); }, []);
  const dismissOverlays = useCallback(() => { overlayRequestRef.current += 1; setHelp(false); setPreviewData(null); setFunctionalProposal(null); }, []);
  const load = useCallback(async () => {
    if (!projectPath) { setGraph(null); announce('当前会话没有工作区', true); return; }
    try {
      announce('正在载入…');
      const next = await request(`/graph?project=${encodeURIComponent(projectPath)}`);
      setGraph(next); setSelected(null); setInspected(null); setImplementationFocus(null); setExpandedImplementation(new Set()); announce(`${next.nodes.length} 个模块`);
      requestAnimationFrame(() => { const svg = svgRef.current; if (svg) setView(fitView(next, svg.clientWidth, svg.clientHeight)); });
    } catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!nodeMenuOpen) return undefined;
    const dismiss = event => { if (!nodeMenuRef.current?.contains(event.target)) setNodeMenuOpen(false); };
    const keydown = event => { if (event.key === 'Escape') setNodeMenuOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', keydown); };
  }, [nodeMenuOpen]);

  const save = useCallback(async () => {
    if (!graphRef.current || !projectPath) return;
    try { announce('正在保存…'); const next = await request('/graph', { method: 'POST', body: JSON.stringify({ projectPath, graph: graphRef.current }) }); setGraph(next); announce('已保存'); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const scan = useCallback(async () => {
    if (!projectPath) return;
    try { announce('正在扫描代码…'); const result = await request('/scan', { method: 'POST', body: JSON.stringify({ projectPath }) }); setGraph(result.graph); setSelected(null); setInspected(null); setImplementationFocus(null); setExpandedImplementation(new Set()); const removed = result.removed?.length ? `，已移除 ${result.removed.length} 个已删除实现` : ''; announce(`扫描完成：${result.graph.nodes.length} 个模块，${result.suggestions.length} 条建议${removed}`); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const fit = useCallback(() => { const svg = svgRef.current; if (svg && graphRef.current) setView(fitView(graphRef.current, svg.clientWidth, svg.clientHeight)); }, []);
  const layout = useCallback(() => {
    if (!graphRef.current) return;
    const next = autoLayout(graphRef.current);
    setGraph(next);
    requestAnimationFrame(() => { const svg = svgRef.current; if (svg) setView(fitView(next, svg.clientWidth, svg.clientHeight)); });
    announce('已自动排布，保存后生效');
  }, [announce]);
  const remove = useCallback(() => {
    const current = selectedRef.current; if (!current) return;
    setGraph(previous => {
      if (current.kind !== 'node') return { ...previous, edges: previous.edges.filter((_edge, index) => index !== current.index) };
      const removedNode = previous.nodes.find(node => node.id === current.id);
      const implementation = Boolean(removedNode && isImplementationNode(removedNode));
      const removedIds = implementation
        ? new Set([current.id, ...containedImplementationDescendants(previous, current.id)])
        : new Set([current.id]);
      const overrides = implementation
        ? { ...(previous.overrides || {}), include: [...(previous.overrides?.include || [])], exclude: [...(previous.overrides?.exclude || [])], deleted: [...new Set([...(previous.overrides?.deleted || []), ...removedIds])] }
        : previous.overrides;
      return {
        ...previous,
        overrides,
        nodes: previous.nodes.filter(node => !removedIds.has(node.id)),
        edges: previous.edges.filter(edge => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
        mappings: (previous.mappings || []).map(mapping => ({ ...mapping, implementation: (mapping.implementation || []).filter(item => !removedIds.has(typeof item === 'string' ? item : item.id)) })).filter(mapping => !removedIds.has(mapping.functional) && mapping.implementation.length > 0),
      };
    });
    setSelected(null); setInspected(null); announce('已删除，保存后生效');
  }, [announce]);
  const addNode = useCallback(type => {
    const template = CREATE_NODE_TYPES.find(([key]) => key === type);
    if (!template) return;
    if (!graphRef.current) { announce('图谱尚未载入', true); return; }
    const [, label, title] = template;
    const ids = new Set(graphRef.current.nodes.map(node => node.id));
    const baseId = `${type}-${Date.now().toString(36)}`;
    let id = baseId; let suffix = 2;
    while (ids.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
    const node = { id, type, title, label: title, content: '', description: '', source: 'user', priority: 'normal', status: 'active', mode: 'MANUAL', metadata: { layer: type === 'functional' ? 'functional' : 'structured' }, x: Math.max(40, (120 - view.x) / view.zoom), y: Math.max(40, (100 - view.y) / view.zoom) };
    setGraph(previous => ({ ...previous, nodes: [...previous.nodes, node] }));
    setNodeMenuOpen(false);
    setSelected({ kind: 'node', id });
    setInspected({ kind: 'node', id });
    announce(`已创建${label}节点，编辑后保存`);
  }, [announce, view]);
  const getSessionSettings = useCallback(async () => {
    if (!projectPath) return DEFAULT_SESSION_CONTEXT;
    try { return await request(`/session-settings?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`); }
    catch { return DEFAULT_SESSION_CONTEXT; }
  }, [projectPath, sessionId]);
  const updateSessionSettings = useCallback(async patch => {
    if (!projectPath) return DEFAULT_SESSION_CONTEXT;
    return request('/session-settings', { method: 'POST', body: JSON.stringify({ projectPath, sessionId, ...patch }) });
  }, [projectPath, sessionId]);
  const showPreview = useCallback(async requestedEntry => {
    const entry = typeof requestedEntry === 'string' ? requestedEntry : selectedRef.current?.kind === 'node' ? selectedRef.current.id : null;
    if (!entry) { announce('请先选择一个入口节点', true); return; }
    const requestId = ++overlayRequestRef.current;
    setHelp(false);
    setFunctionalProposal(null);
    try {
      const settings = await getSessionSettings();
      const previewTask = task.trim() || `预览 ${entry}`;
      const [result, latestAudit] = await Promise.all([
        request('/compile', { method: 'POST', body: JSON.stringify({ projectPath, graph: graphRef.current, entry, task: previewTask, tokenBudget: settings.tokenBudget, maxImplementationFiles: settings.maxImplementationFiles, semanticDepth: settings.semanticDepth, include: settings.include, exclude: settings.exclude }) }),
        request(`/audit?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`).catch(() => null),
      ]);
      const audit = latestAudit?.compiledFingerprint && latestAudit.compiledFingerprint === result.compiledFingerprint ? latestAudit : null;
      if (overlayRequestRef.current === requestId) setPreviewData({ ...result, ...(audit ? { audit } : {}), latestAudit, sessionSettings: settings, previewTask });
    }
    catch (cause) { if (overlayRequestRef.current === requestId) announce(cause.message, true); }
  }, [announce, getSessionSettings, projectPath, sessionId, task]);
  const forceExcludeFromPreview = useCallback(async id => {
    const entry = previewData?.entry || previewData?.target || previewData?.manifest?.entry || previewData?.manifest?.task?.id || null;
    if (!id || id === entry) return;
    const requestId = ++overlayRequestRef.current;
    try { const settings = previewData?.sessionSettings || await getSessionSettings(); const exclude = [...new Set([...(settings.exclude || []), id])]; const include = (settings.include || []).filter(item => item !== id); await updateSessionSettings({ include, exclude }); if (overlayRequestRef.current !== requestId) return; announce(`本会话已强制排除 ${id}`); void showPreview(entry); }
    catch (cause) { if (overlayRequestRef.current === requestId) announce(cause.message, true); }
  }, [announce, getSessionSettings, previewData, showPreview, updateSessionSettings]);
  const forceIncludeFromPreview = useCallback(async id => {
    const entry = previewData?.entry || previewData?.target || previewData?.manifest?.entry || previewData?.manifest?.task?.id || null;
    if (!id || id === entry) return;
    const requestId = ++overlayRequestRef.current;
    try { const settings = previewData?.sessionSettings || await getSessionSettings(); const include = [...new Set([...(settings.include || []), id])]; const exclude = (settings.exclude || []).filter(item => item !== id); await updateSessionSettings({ include, exclude }); if (overlayRequestRef.current !== requestId) return; announce(`本会话已强制包含 ${id}`); void showPreview(entry); }
    catch (cause) { if (overlayRequestRef.current === requestId) announce(cause.message, true); }
  }, [announce, getSessionSettings, previewData, showPreview, updateSessionSettings]);
  const inferFunctional = useCallback(async apply => {
    if (!projectPath) return;
    const requestId = ++overlayRequestRef.current;
    setHelp(false);
    setPreviewData(null);
    try { const result = await request('/functional-infer', { method: 'POST', body: JSON.stringify({ projectPath, apply }) }); if (result.applied) { setGraph(result.graph); if (overlayRequestRef.current === requestId) { setFunctionalProposal(null); announce(`已加入 ${result.proposal.nodes.length} 个功能节点，重新验证 ${result.proposal.updates?.length || 0} 个`); } } else if (overlayRequestRef.current === requestId) setFunctionalProposal(result.proposal); }
    catch (cause) { if (overlayRequestRef.current === requestId) announce(cause.message, true); }
  }, [announce, projectPath]);
  const submit = useCallback(async () => {
    const text = task.trim(); if (!text || sending) return;
    const taskLabel = TASKS.find(([key]) => key === taskType)?.[1] || taskType;
    const target = selected?.kind === 'node' ? `\n目标模块：${selected.id}` : '';
    setSending(true);
    try { await sendPrompt(`任务类型：${taskLabel}${target}\n\n${text}`); setTask(''); announce('任务已发送到当前会话'); }
    catch (cause) { announce(cause.message, true); }
    finally { setSending(false); }
  }, [announce, selected, sendPrompt, sending, task, taskType]);

  useEffect(() => {
    const keydown = event => {
      const editing = /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); }
      else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); remove(); }
      else if (!editing && event.key.toLowerCase() === 'f') fit();
      else if (!editing && event.key.toLowerCase() === 'a') layout();
      else if (event.key === 'Escape') { setGesture(null); setSelected(null); setInspected(null); dismissOverlays(); setNodeMenuOpen(false); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [dismissOverlays, fit, layout, remove, save, submit]);

  const implementationHierarchy = useMemo(() => buildImplementationHierarchy(graph), [graph]);
  const implementationScope = useMemo(() => {
    const mapped = new Set((graph?.mappings || []).filter(mapping => !implementationFocus || mapping.functional === implementationFocus).flatMap(mapping => (mapping.implementation || []).map(item => typeof item === 'string' ? item : item.id)));
    if (!implementationFocus) return mapped;
    const result = new Set([implementationFocus]);
    for (const id of mapped) {
      result.add(id);
      for (const ancestor of implementationHierarchy.ancestorsOf(id)) result.add(ancestor);
      for (const descendant of implementationHierarchy.descendantsOf(id)) result.add(descendant);
    }
    return result;
  }, [graph, implementationFocus, implementationHierarchy]);
  const visibleNodes = useMemo(() => {
    const previewManifest = contextManifest(previewData || {});
    const preview = new Set(previewManifest.included.map(item => item.node || item.module || item.id));
    return (graph?.nodes || []).filter(node => {
      const type = node.type || 'code_module'; const implementation = isImplementationNode(node);
      const ancestorsExpanded = implementationHierarchy.ancestorsOf(node.id).every(id => expandedImplementation.has(id));
      const implementationVisible = node.id === implementationFocus || implementation && (!implementationFocus || implementationScope.has(node.id)) && implementationLevel(node) <= Number(implementationDetail) && ancestorsExpanded;
      const visible = viewMode === 'semantic' ? !implementation && type !== 'conversation' : viewMode === 'implementation' ? implementationVisible : preview.has(node.id);
      return visible && (typeFilter === 'all' || type === typeFilter) && (!search.trim() || `${node.title || node.label || node.id} ${node.content || ''} ${node.path || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
    });
  }, [expandedImplementation, graph, implementationDetail, implementationFocus, implementationHierarchy, implementationScope, previewData, search, typeFilter, viewMode]);
  const displayEdges = useMemo(() => {
    const visible = new Set(visibleNodes.map(node => node.id)); const mapEdges = viewMode === 'implementation' ? (graph?.mappings || []).filter(mapping => !implementationFocus || mapping.functional === implementationFocus).flatMap(mapping => (mapping.implementation || []).map(item => ({ source: mapping.functional, target: typeof item === 'string' ? item : item.id, type: 'implemented_by', scope: [], mode: mapping.mode || 'AUTO', status: mapping.status || (typeof item === 'object' ? item.status : undefined) }))) : [];
    return [...(graph?.edges || []).map((edge, index) => ({ ...edge, _index: index })), ...mapEdges].filter(edge => visible.has(edge.source) && visible.has(edge.target));
  }, [graph, implementationFocus, viewMode, visibleNodes]);
  const nodes = useMemo(() => new Map(visibleNodes.map(node => [node.id, node])), [visibleNodes]);
  const updateNode = patch => setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === inspected.id ? { ...node, ...patch } : node) }));
  const updateEdge = patch => setGraph(previous => ({ ...previous, edges: previous.edges.map((edge, index) => index === inspected.index ? { ...edge, ...patch } : edge) }));
  const selectItem = item => {
    const key = item.kind === 'node' ? `node:${item.id}` : `edge:${item.index}`;
    const now = Date.now();
    const doublePressed = pressRef.current.key === key && now - pressRef.current.time <= DOUBLE_PRESS_MS;
    pressRef.current = { key, time: now };
    setSelected(item);
    if (item.kind === 'node') setTarget(item.id);
    setInspected(doublePressed ? item : null);
  };
  const toggleImplementationNode = id => {
    if (!expandedImplementation.has(id)) {
      const levels = (implementationHierarchy.children.get(id) || []).map(child => implementationLevel(graph?.nodes.find(node => node.id === child)));
      if (levels.length) setImplementationDetail(current => String(Math.max(Number(current), Math.min(...levels))));
    }
    setExpandedImplementation(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const point = event => graphPoint(svgRef.current, view, event.clientX, event.clientY);
  const startPan = event => { if (event.button !== 0) return; event.preventDefault(); pressRef.current = { key: '', time: 0 }; event.currentTarget.setPointerCapture(event.pointerId); setSelected(null); setInspected(null); setGesture({ kind: 'pan', startX: event.clientX, startY: event.clientY, x: view.x, y: view.y }); };
  const move = event => {
    if (!gesture) return;
    if (gesture.kind === 'pan') setView(current => ({ ...current, x: gesture.x + event.clientX - gesture.startX, y: gesture.y + event.clientY - gesture.startY }));
    if (gesture.kind === 'node') { const p = point(event); setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === gesture.id ? { ...node, x: p.x - gesture.dx, y: p.y - gesture.dy } : node) })); }
    if (gesture.kind === 'connect') setGesture({ ...gesture, point: point(event) });
  };
  const stop = event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setGesture(null); };
  const connect = target => {
    if (gesture?.kind !== 'connect' || gesture.source === target) { setGesture(null); return; }
    setGraph(previous => previous.edges.some(edge => edge.source === gesture.source && edge.target === target) ? previous : ({ ...previous, edges: [...previous.edges, { source: gesture.source, target, type: 'related_to', scope: ['content'], mode: 'MANUAL' }] }));
    setGesture(null); announce('已创建连接，保存后生效');
  };

  return h('div', { className: 'cg-root' },
    h('header', { className: 'cg-header' },
      h('div', { className: 'cg-title' }, '上下文图谱'),
      h('select', { className: 'cg-filter', value: viewMode, onChange: event => { setViewMode(event.target.value); setImplementationFocus(null); setExpandedImplementation(new Set()); setTypeFilter('all'); } }, h('option', { value: 'semantic' }, '语义'), h('option', { value: 'implementation' }, '实现'), h('option', { value: 'context' }, '当前上下文')),
      viewMode === 'implementation' ? h('select', { className: 'cg-filter cg-level-filter', value: implementationDetail, title: '实现层级', 'aria-label': '实现层级', onChange: event => setImplementationDetail(event.target.value) }, IMPLEMENTATION_LEVELS.map(([value, label]) => h('option', { key: value, value }, label))) : null,
      h('input', { className: 'cg-search', value: search, placeholder: '搜索节点', onChange: event => setSearch(event.target.value) }),
      h('select', { className: 'cg-filter cg-type-filter', value: typeFilter, onChange: event => setTypeFilter(event.target.value) }, h('option', { value: 'all' }, '全部类型'), NODE_TYPES.map(type => h('option', { key: type, value: type }, type))),
      h('span', { ref: nodeMenuRef, className: 'cg-node-menu-anchor' },
        h(IconButton, { label: '新建节点', onClick: () => setNodeMenuOpen(value => !value) }, '+'),
        nodeMenuOpen ? h('div', { className: 'cg-node-menu', role: 'menu', 'aria-label': '新建节点类型' }, CREATE_NODE_TYPES.map(([type, label]) => h('button', { key: type, className: 'cg-node-menu-item', type: 'button', role: 'menuitem', onClick: () => addNode(type) }, label))) : null),
      h(IconButton, { label: '推断功能模块', onClick: () => void inferFunctional(false) }, '◇'),
      h(IconButton, { label: 'Context Preview', onClick: showPreview }, '◎'),
      h(IconButton, { label: '扫描代码', onClick: scan }, '↻'),
      h(IconButton, { label: '保存 (Ctrl+S)', onClick: save }, '⌑'),
      h(IconButton, { label: '快捷键', onClick: () => { overlayRequestRef.current += 1; setPreviewData(null); setFunctionalProposal(null); setHelp(value => !value); } }, '?')),
    h('div', { className: 'cg-canvas-wrap' },
      h('svg', { ref: svgRef, className: 'cg-canvas', 'data-dragging': Boolean(gesture), onPointerDown: startPan, onPointerMove: move, onPointerUp: stop, onPointerCancel: stop,
        onWheel: event => { event.preventDefault(); const before = point(event); const zoom = Math.min(2, Math.max(.25, view.zoom * (event.deltaY > 0 ? .9 : 1.1))); const rect = svgRef.current.getBoundingClientRect(); setView({ zoom, x: event.clientX - rect.left - before.x * zoom, y: event.clientY - rect.top - before.y * zoom }); } },
        h('defs', null, h('marker', { id: 'cg-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' }, h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'context-stroke' }))),
        h('g', { transform: `translate(${view.x} ${view.y}) scale(${view.zoom})` },
          displayEdges.map((edge, index) => { const source = nodes.get(edge.source); const target = nodes.get(edge.target); if (!source || !target) return null; const d = edgePath(source, target); const stale = edge.status === 'stale' || source.status === 'stale' || target.status === 'stale'; return h('g', { key: `${edge.source}-${edge.target}-${edge.type}-${index}`, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); if (edge._index !== undefined) selectItem({ kind: 'edge', index: edge._index }); } }, h('path', { d, className: 'cg-edge-hit' }), h('path', { d, className: 'cg-edge', 'data-type': edge.type, 'data-stale': stale, 'data-selected': selected?.kind === 'edge' && selected.index === edge._index, markerEnd: 'url(#cg-arrow)' })); }),
          gesture?.kind === 'connect' && nodes.get(gesture.source) ? h('path', { className: 'cg-temp', d: edgePath(nodes.get(gesture.source), { x: gesture.point.x, y: gesture.point.y - NODE_H / 2 }) }) : null,
          visibleNodes.map(node => { const childCount = (implementationHierarchy.children.get(node.id) || []).filter(id => !implementationFocus || implementationScope.has(id)).length; const expandable = viewMode === 'implementation' && childCount > 0; return h('g', { key: node.id, className: 'cg-node', transform: `translate(${node.x || 0} ${node.y || 0})`, 'data-selected': selected?.kind === 'node' && selected.id === node.id, 'data-mode': node.mode || 'AUTO', 'data-status': node.status || 'active', 'data-node-type': node.type || 'code_module',
            onPointerDown: event => { event.preventDefault(); event.stopPropagation(); const p = point(event); svgRef.current.setPointerCapture(event.pointerId); selectItem({ kind: 'node', id: node.id }); setGesture({ kind: 'node', id: node.id, dx: p.x - (node.x || 0), dy: p.y - (node.y || 0) }); } },
            h('rect', { className: 'cg-node-box', width: NODE_W, height: NODE_H, rx: 5 }),
            h('path', { className: 'cg-node-head', d: `M5 0 H${NODE_W - 5} Q${NODE_W} 0 ${NODE_W} 5 V28 H0 V5 Q0 0 5 0` }),
            h('text', { className: 'cg-node-title', x: 11, y: 19 }, truncateNodeText(node.label || node.id, NODE_W - (expandable ? 47 : 22), 12)),
            expandable ? h('g', { className: 'cg-node-expand', role: 'button', tabIndex: 0, 'aria-label': `${expandedImplementation.has(node.id) ? '折叠' : '展开'} ${node.label || node.id}`, transform: `translate(${NODE_W - 25} 5)`, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); }, onClick: event => { event.preventDefault(); event.stopPropagation(); toggleImplementationNode(node.id); }, onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleImplementationNode(node.id); } } }, h('title', null, expandedImplementation.has(node.id) ? '折叠下级实现' : `展开 ${childCount} 个下级实现`), h('rect', { width: 18, height: 18, rx: 3 }), h('text', { x: 9, y: 13, textAnchor: 'middle' }, expandedImplementation.has(node.id) ? '−' : '+')) : null,
            h('text', { className: 'cg-node-meta', x: 11, y: 48 }, truncateNodeText(node.type === 'code_module' || !node.type ? node.path || '未设置路径' : node.type, NODE_W - 22, 10)),
            h('text', { className: 'cg-node-meta', x: 11, y: 69 }, truncateNodeText(node.type === 'code_module' || !node.type ? node.mode || 'AUTO' : `${node.priority || 'normal'} · ${node.status || 'active'}`, NODE_W - 22, 10)),
            h('circle', { className: 'cg-port', cx: 0, cy: NODE_H / 2, r: 6, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); }, onPointerUp: event => { event.preventDefault(); event.stopPropagation(); connect(node.id); } }),
            h('circle', { className: 'cg-port', cx: NODE_W, cy: NODE_H / 2, r: 6, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); setSelected({ kind: 'node', id: node.id }); setInspected(null); setGesture({ kind: 'connect', source: node.id, point: point(event) }); } })); }),
        )),
      h('div', { className: 'cg-tools' }, h(IconButton, { label: '放大', onClick: () => setView(current => ({ ...current, zoom: Math.min(2, current.zoom * 1.15) })) }, '+'), h(IconButton, { label: '缩小', onClick: () => setView(current => ({ ...current, zoom: Math.max(.25, current.zoom / 1.15) })) }, '−'), h(IconButton, { label: '适合画布 (F)', onClick: fit }, '□'), h(IconButton, { label: '自动排布 (A)', onClick: layout }, '≡')),
      !visibleNodes.length ? h('div', { className: 'cg-empty' }, h('strong', null, graph?.nodes.length ? '没有匹配节点' : '暂无上下文节点'), h('span', null, graph?.nodes.length ? '调整搜索或类型筛选' : '扫描代码或新建上下文节点')) : null,
      h('div', { className: 'cg-status', 'data-error': error }, status),
      h(Inspector, { graph: graph || { nodes: [], edges: [], mappings: [] }, selected: inspected, updateNode, updateEdge, remove, showImplementation: id => { setImplementationFocus(id); setImplementationDetail('0'); setExpandedImplementation(new Set()); setTypeFilter('all'); setViewMode('implementation'); } }),
      help ? h('section', { className: 'cg-help' }, h('h3', null, '快捷键'), h('dl', null,
        h('dt', null, 'Ctrl/⌘ + S'), h('dd', null, '保存图谱'), h('dt', null, 'Ctrl/⌘ + Enter'), h('dd', null, '发送任务'), h('dt', null, 'Delete'), h('dd', null, '删除所选节点或连接'), h('dt', null, 'F'), h('dd', null, '适合画布'), h('dt', null, 'A'), h('dd', null, '自动排布'), h('dt', null, 'Esc'), h('dd', null, '取消连接或选择'), h('dt', null, '拖动端口'), h('dd', null, '手动创建连接'))) : null,
      previewData ? h(ContextPreviewPanel, { data: previewData, onClose: dismissOverlays, onForceExclude: id => void forceExcludeFromPreview(id), onForceInclude: id => void forceIncludeFromPreview(id) }) : null,
      functionalProposal ? h(FunctionalProposalPanel, { proposal: functionalProposal, graph, onClose: dismissOverlays, onConfirm: () => void inferFunctional(true) }) : null),
    );
}

const inject = ['slots', 'sessions'];

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.contextGraph = 'true';
    style.textContent = `${styles}${TASK_WORKFLOW_STYLES}`;
    document.head.append(style);
    return () => style.remove();
  }, 'context-graph: styles');

  ctx.inject(['slots', 'sessions', 'conversation'], scope => {
    const targetListeners = new Map(); const targets = new Map();
    const targetStore = { get: id => targets.get(id) || '', set: (id, value) => { targets.set(id, value); for (const listener of targetListeners.get(id) || []) listener(value); }, subscribe: (id, listener) => { const listeners = targetListeners.get(id) || new Set(); listeners.add(listener); targetListeners.set(id, listeners); return () => listeners.delete(listener); } };
    const sendSessionPrompt = async (sessionId, text) => {
      const sessionScope = scope.sessions.scope(sessionId);
      const conversation = sessionScope?.get('conversation');
      if (!conversation) throw new Error('当前会话尚未准备好');
      await conversation.send(text);
    };
    const disposeContext = scope.slots.inject('conversation.input.left', () => scope.slots.register({ name: 'conversation.input.left', id: 'context-graph-task', order: 100, registrant: 'dsh-context-graph', inject: sessionId => ({ sessionId, projectPath: scope.sessions.list.getSnapshot().byId[sessionId]?.cwd || '', targetStore, sendPrompt: text => sendSessionPrompt(sessionId, text) }) }, ContextCommand));
    const disposeView = scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: 'context-graph',
      order: 20,
      label: () => '上下文图谱',
      registrant: 'dsh-context-graph',
      inject: sessionId => {
        const projectPath = scope.sessions.list.getSnapshot().byId[sessionId]?.cwd || '';
        return {
          sessionId,
          projectPath,
          setTarget: value => targetStore.set(sessionId, value),
          sendPrompt: text => sendSessionPrompt(sessionId, text),
        };
      },
    }, GraphPanel));
    return () => { disposeContext(); disposeView(); };
  });
}

return { inject, apply };
    },
  });
})();
