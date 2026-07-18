import { usePoseStore } from '../stores/PoseStore';
import { poseManager } from '../managers/PoseManager';
import tagCategoriesRaw from '../data/tags.json';
import type { TagCategory } from '../types/Tag';

const tagCategories = tagCategoriesRaw as TagCategory[];

type TagSearchPanelProps = {
  onClose: () => void;
};

// docs/10: タグ検索のみ・複数タグAND検索・カテゴリ順表示。
// 自由入力検索は行わない。
export function TagSearchPanel({ onClose }: TagSearchPanelProps) {
  const selectedTags = usePoseStore((state) => state.selectedTags);
  const filteredCount = usePoseStore((state) => state.filteredPoseIds.length);

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag];
    poseManager.setSelectedTags(next);
  };

  return (
    <div className="panel-overlay" role="dialog" aria-label="タグ検索">
      <div className="panel">
        <div className="panel-header">
          <h2>タグ検索</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        {tagCategories.map((category) => (
          <fieldset key={category.category} className="tag-category">
            <legend>{category.category}</legend>
            <div className="tag-list">
              {category.tags.map((tag) => (
                <label key={tag} className="tag-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedTags.includes(tag)}
                    onChange={() => toggleTag(tag)}
                  />
                  {tag}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="panel-footer">
          <span>{filteredCount}件ヒット</span>
          <button type="button" onClick={() => poseManager.clearFilters()}>
            クリア
          </button>
        </div>
      </div>
    </div>
  );
}
