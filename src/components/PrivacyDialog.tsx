// 首次启动隐私说明弹窗
// M8.5 T8.5.1 - 首次使用时展示隐私说明，用户确认后不再显示

import { useState, useEffect } from 'react';
import { getPreference, setPreference } from '@/lib/sqlite';

const PRIVACY_ACK_KEY = 'privacy_acknowledged';

export function PrivacyDialog() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    (async () => {
      const ack = await getPreference<string>(PRIVACY_ACK_KEY, '');
      if (!ack) {
        setVisible(true);
      }
    })();
  }, []);

  const onAccept = async () => {
    await setPreference(PRIVACY_ACK_KEY, new Date().toISOString());
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70"
      style={{ zIndex: 20000 }}
      data-no-drag
    >
      <div className="bg-surface-1 border border-border rounded-card shadow-popover w-[440px] max-w-[90vw] overflow-hidden">
        {/* 标题栏 */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-brand">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </span>
            <span className="text-text-primary text-sm font-semibold">隐私说明</span>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-5 py-4 space-y-3 text-xs text-text-secondary leading-relaxed">
          <p>
            感谢使用<strong className="text-text-primary">灵感大王</strong>。在开始之前，请了解以下隐私条款：
          </p>

          <div className="space-y-2.5">
            <div className="flex gap-2">
              <span className="text-semantic-success flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <div className="text-text-primary font-medium">数据本地存储</div>
                <div className="text-text-tertiary mt-0.5">所有数据（提示词历史、偏好设置）仅保存在你的电脑本地，不上传任何服务器。</div>
              </div>
            </div>

            <div className="flex gap-2">
              <span className="text-semantic-success flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <div className="text-text-primary font-medium">密钥安全加密</div>
                <div className="text-text-tertiary mt-0.5">API 密钥通过 Windows Credential Manager 加密存储，不明文保存在文件中。</div>
              </div>
            </div>

            <div className="flex gap-2">
              <span className="text-semantic-success flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <div className="text-text-primary font-medium">敏感文件保护</div>
                <div className="text-text-tertiary mt-0.5">项目扫描时自动跳过 .env、密钥文件等敏感文件，不会读取或上传。</div>
              </div>
            </div>

            <div className="flex gap-2">
              <span className="text-semantic-success flex-shrink-0 mt-0.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <div className="text-text-primary font-medium">LLM 调用可控</div>
                <div className="text-text-tertiary mt-0.5">仅在你配置了 AI 模型后才会向 LLM 服务商发送请求，发送内容为你输入的需求描述。</div>
              </div>
            </div>
          </div>

          <p className="text-text-tertiary text-[10px] pt-1">
            点击「我已了解」即表示你已阅读并同意以上隐私条款。
          </p>
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-3 border-t border-border flex justify-end">
          <button
            onClick={onAccept}
            className="primary-btn px-5 py-2 text-xs"
          >
            我已了解
          </button>
        </div>
      </div>
    </div>
  );
}
