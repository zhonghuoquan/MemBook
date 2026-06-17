export function ToolsPanel() {
  return (
    <aside className="flex-1 bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border-light)]">
        <span className="text-[var(--text-body)] font-[500] text-[var(--color-gray-800)]">工具</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Background Colors */}
        <div>
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">背景</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { color: 'var(--color-white)', label: '白色' },
              { color: 'var(--color-gray-100)', label: '暖灰' },
              { color: 'var(--color-primary-50)', label: '珊瑚浅' },
              { color: 'var(--color-info-light)', label: '浅蓝' },
            ].map((item) => (
              <div
                key={item.label}
                className="aspect-square rounded-[var(--radius-md)] border border-[var(--color-border)]
                           cursor-pointer hover:border-[var(--color-primary-400)] transition-colors"
                style={{ backgroundColor: item.color }}
                title={item.label}
              />
            ))}
          </div>
        </div>

        {/* Text */}
        <div>
          <div className="text-[var(--text-caption)] font-[500] text-[var(--color-gray-600)] mb-2">文字</div>
          <button className="w-full flex items-center justify-center gap-1.5 py-2 px-3
                             border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]
                             text-[var(--text-body-sm)] text-[var(--color-gray-500)]
                             bg-transparent cursor-pointer
                             hover:border-[var(--color-primary-400)] hover:text-[var(--color-primary-600)]
                             transition-colors">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
              <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            添加文字
          </button>
        </div>
      </div>
    </aside>
  );
}
