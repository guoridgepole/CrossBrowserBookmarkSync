import { describe, it, expect } from 'vitest';
import {
  ROOT_IDS,
  ROOT_NAME_MAP,
  ROOT_BROWSER_ID_MAP,
  isRootFolder,
} from '@/core/types';

describe('root folder mapping', () => {
  it('should map Chrome browser-native IDs (language-independent)', () => {
    expect(ROOT_BROWSER_ID_MAP['1']).toBe('toolbar');
    expect(ROOT_BROWSER_ID_MAP['2']).toBe('other');
    expect(ROOT_BROWSER_ID_MAP['3']).toBe('mobile');
  });

  it('should map Firefox browser-native IDs', () => {
    expect(ROOT_BROWSER_ID_MAP['toolbar_____']).toBe('toolbar');
    expect(ROOT_BROWSER_ID_MAP['menu________']).toBe('menu');
    expect(ROOT_BROWSER_ID_MAP['unfiled_____']).toBe('other');
    expect(ROOT_BROWSER_ID_MAP['mobile______']).toBe('mobile');
  });

  it('should map Chinese (simplified) root folder titles', () => {
    expect(ROOT_NAME_MAP['书签栏']).toBe('toolbar');
    expect(ROOT_NAME_MAP['其他书签']).toBe('other');
    expect(ROOT_NAME_MAP['移动设备书签']).toBe('mobile');
    expect(ROOT_NAME_MAP['书签工具栏']).toBe('toolbar');
    expect(ROOT_NAME_MAP['书签菜单']).toBe('menu');
  });

  it('should map English root folder titles', () => {
    expect(ROOT_NAME_MAP['Bookmarks bar']).toBe('toolbar');
    expect(ROOT_NAME_MAP['Other bookmarks']).toBe('other');
    expect(ROOT_NAME_MAP['Bookmarks Menu']).toBe('menu');
  });

  it('isRootFolder should recognize all well-known root IDs', () => {
    for (const id of Object.values(ROOT_IDS)) {
      expect(isRootFolder(id)).toBe(true);
    }
  });

  it('isRootFolder should reject non-root IDs', () => {
    expect(isRootFolder('root-unknown-0')).toBe(false);
    expect(isRootFolder('some-bookmark-id')).toBe(false);
  });
});
