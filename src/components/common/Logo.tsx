import { useTheme } from '../../contexts/ThemeContext';
import logoDark from '../../assets/logo-dark.png';
import logoLight from '../../assets/logo-light.png';

/**
 * MemBook Logo
 * - 亮色模式：使用 logo-light.png
 * - 深色模式：使用 logo-dark.png
 *
 * 需要将 logo 图标文件放在 src/assets/ 下：
 *   - src/assets/logo-dark.png   深色模式（白线）
 *   - src/assets/logo-light.png  亮色模式（黑线）
 */
export function Logo({ className = '' }: { className?: string }) {
  const { resolved } = useTheme();
  const isDark = resolved === 'dark';

  return (
    <img
      src={isDark ? logoDark : logoLight}
      alt="MemBook"
      className={className + ' object-contain'}
      draggable={false}
    />
  );
}
