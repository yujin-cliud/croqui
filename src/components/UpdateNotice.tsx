type UpdateNoticeProps = {
  onReload: () => void;
};

// docs/11: PWAの更新通知。インストールを強制せず、押した時だけ再読み込みする。
export function UpdateNotice({ onReload }: UpdateNoticeProps) {
  return (
    <div className="update-notice">
      <span>新しいバージョンがあります。</span>
      <button type="button" onClick={onReload}>
        再読み込み
      </button>
    </div>
  );
}
