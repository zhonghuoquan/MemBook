import { useState, useEffect } from 'react';
import { ProjectGrid } from './../home/ProjectGrid';
import { TemplateGallery } from './../home/TemplateGallery';
import { CreateDialog } from './../home/CreateDialog';
import { useEditorStore, usePhotoStore, useUIStore } from '../../store';
import { createAndSaveProject, savePhotos } from '../../db';
import { TEMPLATES, PAGE_MARGIN_DEFAULT, PAGE_GAP_DEFAULT } from '../../types';
import type { AlbumSize, AlbumPage, AlbumProject, PageMargin } from '../../types';
import type { HomeTab } from '../../types';

const NAV_SESSION_KEY = 'membook-home-nav';

interface HomeViewProps {
  onNavigateToEditor: () => void;
}

export function HomeView({ onNavigateToEditor }: HomeViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [activeNav, setActiveNav] = useState<HomeTab>(() => {
    try {
      const saved = sessionStorage.getItem(NAV_SESSION_KEY);
      if (saved === 'create' || saved === 'projects' || saved === 'templates') return saved;
    } catch { /* ignore */ }
    return 'projects';
  });

  // 持久化当前导航 Tab
  useEffect(() => {
    try { sessionStorage.setItem(NAV_SESSION_KEY, activeNav); } catch { /* ignore */ }
  }, [activeNav]);
  const setPages = useEditorStore((s) => s.setPages);
  const setAlbumSize = useEditorStore((s) => s.setAlbumSize);
  const setPhotos = usePhotoStore((s) => s.setPhotos);
  const setStorageMode = useUIStore((s) => s.setStorageMode);

  const loadDemoAndNavigate = async () => {
    const demo = getDemoProject();
    setPages(demo.pages);
    setAlbumSize(demo.size);
    setPhotos(getDemoPhotos());
    await savePhotos(getDemoPhotos());
    // 保存到 IndexedDB，刷新不丢失
    await createAndSaveProject('我的旅行回忆', demo.size, demo.pages, demo.margin);
    onNavigateToEditor();
  };

  const handleCreateAlbum = async (_name: string, _size: AlbumSize, _margin: PageMargin) => {
    // 创建一页空白页，不加载任何演示数据
    const blankPage: AlbumPage = {
      id: `page-${Date.now()}`,
      templateId: 'full',
      placements: [{ slotId: 'main', photoId: null }],
      background: '#FFFFFF',
    };
    setPages([blankPage]);
    setAlbumSize(_size);
    setPhotos([]);
    await savePhotos([]);
    await createAndSaveProject(_name || '未命名相册', _size, [blankPage], _margin);
    setStorageMode(null);  // 重置存储偏好，下次导入时重新选择
    onNavigateToEditor();
  };

  const handleCreateFromTemplate = async (templateId: string, name: string, size: AlbumSize) => {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    const page: AlbumPage = {
      id: `page-${Date.now()}`,
      templateId,
      placements: template.slots.map((slot) => ({
        slotId: slot.id,
        photoId: null,
      })),
      background: '#FFFFFF',
    };

    setPages([page]);
    setAlbumSize(size);
    setPhotos([]);
    await savePhotos([]);
    await createAndSaveProject(name || '未命名相册', size, [page], { margin: PAGE_MARGIN_DEFAULT, gap: PAGE_GAP_DEFAULT });
    setStorageMode(null);  // 重置存储偏好，下次导入时重新选择
    onNavigateToEditor();
  };

  const handleOpenProject = (project: AlbumProject) => {
    if (project.pages && project.pages.length > 0) {
      setPages(project.pages);
      setAlbumSize(project.size);
      localStorage.setItem('membook_current_project_id', project.id);
    } else {
      loadDemoAndNavigate();
      return;
    }
    onNavigateToEditor();
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Top Header Bar ── */}
      <header className="h-[var(--layout-home-header-height)] bg-white border-b border-[var(--color-border)]
                         flex items-center px-5 shrink-0 z-[var(--z-flat)]">
        {/* Logo + Product Name */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-[var(--color-gray-800)]">
              {/* Album cover with folded corner */}
              <path d="M4 4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" />
              <path d="M15 2v5h5" />
              {/* Photo inside: mountain + sun */}
              <path d="M7 17l3-4 2.5 3 2-2.5L17 17H7z" />
              <circle cx="15" cy="9" r="1" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <span className="text-[2rem] font-[600] text-[var(--color-text-primary)]"
                style={{ fontFamily: "'Quicksand', sans-serif" }}>
            MemBook
          </span>
        </div>

        <div className="flex-1" />
      </header>

      {/* ── Body: Nav + Content ── */}
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-[var(--layout-nav-width)] bg-white border-r border-[var(--color-border)]
                        flex flex-col items-center py-3 gap-1 shrink-0">
          <HomeNavItem active={activeNav === 'create'} label="创建" onClick={() => { setActiveNav('create'); setShowCreate(true); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
              <circle cx="10" cy="10" r="7" />
              <line x1="10" y1="6" x2="10" y2="14" />
              <line x1="6" y1="10" x2="14" y2="10" />
            </svg>
          </HomeNavItem>
          <HomeNavItem active={activeNav === 'projects'} label="项目" onClick={() => setActiveNav('projects')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="11" y="3" width="6" height="6" rx="1" />
              <rect x="3" y="11" width="6" height="6" rx="1" />
              <rect x="11" y="11" width="6" height="6" rx="1" />
            </svg>
          </HomeNavItem>
          <HomeNavItem active={activeNav === 'templates'} label="模板" onClick={() => setActiveNav('templates')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <rect x="3" y="3" width="14" height="14" rx="2" />
              <rect x="5" y="5" width="10" height="10" rx="1" />
              <line x1="5" y1="9" x2="15" y2="9" />
              <line x1="10" y1="5" x2="10" y2="15" />
            </svg>
          </HomeNavItem>
        </nav>

        {/* Content */}
        <div className="flex-1 flex bg-[var(--color-gray-50)]">
          {activeNav === 'projects' && (
            <ProjectGrid onOpenProject={handleOpenProject} onCreateNew={() => setShowCreate(true)} />
          )}
          {activeNav === 'templates' && (
            <TemplateGallery onCreateFromTemplate={handleCreateFromTemplate} />
          )}
        </div>
      </div>

      <CreateDialog
        open={showCreate}
        onClose={() => { setShowCreate(false); setActiveNav('projects'); }}
        onCreate={handleCreateAlbum}
      />
    </div>
  );
}

function HomeNavItem({
  active = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`
        flex flex-col items-center justify-center w-12 py-2 px-1
        border-none rounded-[var(--radius-md)] cursor-pointer select-none
        text-[var(--text-nano)] font-[500]
        transition-[background-color,color] duration-150
        ${active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-brand)]'
          : 'bg-transparent text-[var(--color-gray-500)]'
        }
        hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-gray-700)]
      `}
      onClick={onClick}
    >
      {children}
      <span className="mt-1">{label}</span>
    </button>
  );
}
