// src/components/TemplateLibrary.tsx
// 用户变量模板库（R05）：列表 + 填参复用 + 删除；TemplateSaveDialog 供结果页存模板。
// 分层：UI 只调 lib/templateStore（IO）与 engine/TemplateComposer（纯逻辑），
// 组装好的文本经 onUse 回传给宿主（ExpandedCard 注入主输入框）。
import { useEffect, useRef, useState } from 'react';
import {
  parseTemplateVariables,
  inferVariableType,
  composePrompt,
  buildUserTemplate,
  type UserTemplate,
} from '@/engine/TemplateComposer';
import {
  saveTemplate,
  listTemplates,
  deleteTemplate,
  type TemplateRow,
} from '@/lib/templateStore';
import { EmptyState } from './ui/EmptyState';

/** 存储行 → engine 模板（tags JSON 解析在 lib 层已保证为数组字符串） */
function rowToTemplate(row: TemplateRow): UserTemplate {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    tags,
    vars: parseTemplateVariables(row.body),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface TemplateLibraryProps {
  /** 填充完成的提示词回传（ExpandedCard 注入主输入框） */
  onUse: (text: string) => void;
}

/**
 * 模板库面板：折叠头 + 列表 + 填参对话框。
 * 缺参时禁止生成并高亮缺失项（验收标准）。
 */
export function TemplateLibrary({ onUse }: TemplateLibraryProps) {
  const [expanded, setExpanded] = useState(false);
  const [templates, setTemplates] = useState<UserTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  // 正在填参的模板（null = 关闭对话框）
  const [filling, setFilling] = useState<UserTemplate | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const mountedRef = useRef(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await listTemplates();
      if (mountedRef.current) setTemplates(rows.map(rowToTemplate));
    } catch (e) {
      console.warn('[TemplateLibrary] 加载模板失败', e);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openFill = (tpl: UserTemplate) => {
    setFilling(tpl);
    setValues({});
    setAttempted(false);
  };

  const closeFill = () => {
    setFilling(null);
    setValues({});
    setAttempted(false);
  };

  const confirmFill = () => {
    if (!filling) return;
    const result = composePrompt(filling.body, values);
    if (!result.ok) {
      setAttempted(true);
      return;
    }
    onUse(result.text);
    closeFill();
  };

  const onDelete = async (id: string) => {
    try {
      await deleteTemplate(id);
      if (mountedRef.current) setTemplates((list) => list.filter((t) => t.id !== id));
    } catch (e) {
      console.warn('[TemplateLibrary] 删除模板失败', e);
    }
  };

  const vars = filling ? parseTemplateVariables(filling.body) : [];
  const missing = attempted
    ? vars.filter((v) => !(values[v] ?? '').trim())
    : [];

  return (
    <div className="px-5 py-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        aria-expanded={expanded}
      >
        <span>我的模板（{templates.length}）</span>
        {loading && <span className="text-text-tertiary">加载中…</span>}
        <span className="ml-auto">{expanded ? '收起 ▴' : '展开 ▾'}</span>
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5" role="list" aria-label="模板列表">
          {templates.length === 0 && !loading && (
            <EmptyState
              title="还没有保存的模板"
              description="在结果页点「存为模板」，把提示词中的可变部分改成 {{变量名}} 即可复用"
            />
          )}
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              role="listitem"
              className="flex items-center gap-2 px-3 py-2 rounded-btn border border-border bg-surface-2/50"
            >
              <button
                type="button"
                onClick={() => openFill(tpl)}
                className="flex-1 text-left min-w-0"
                title={tpl.vars.length > 0 ? `变量：${tpl.vars.join('、')}` : '无变量，直接使用'}
              >
                <div className="text-xs text-text-primary truncate">{tpl.name}</div>
                <div className="text-[10px] text-text-tertiary">
                  {tpl.vars.length > 0 ? `${tpl.vars.length} 个变量：${tpl.vars.join('、')}` : '无变量'}
                  {tpl.tags.length > 0 && ` · ${tpl.tags.join('/')}`}
                </div>
              </button>
              <button
                type="button"
                onClick={() => void onDelete(tpl.id)}
                className="shrink-0 text-[10px] text-text-tertiary hover:text-semantic-error transition-colors"
                aria-label={`删除模板 ${tpl.name}`}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 填参对话框 */}
      {filling && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
          role="dialog"
          aria-label={`填充模板 ${filling.name}`}
        >
          <div className="w-[320px] max-h-[80vh] overflow-y-auto bg-surface rounded-xl border border-border p-4 flex flex-col gap-3">
            <div className="text-sm text-text-primary font-medium">使用模板：{filling.name}</div>
            {vars.length === 0 ? (
              <div className="text-xs text-text-tertiary">该模板没有变量，可直接使用。</div>
            ) : (
              vars.map((v) => {
                const type = inferVariableType(v);
                const isMissing = missing.includes(v);
                return (
                  <label key={v} className="flex flex-col gap-1">
                    <span className={`text-xs ${isMissing ? 'text-semantic-error' : 'text-text-secondary'}`}>
                      {v}
                      <span className="text-text-tertiary">（{type === 'number' ? '数字' : '文本'}）</span>
                      {isMissing && <span className="ml-1">· 必填</span>}
                    </span>
                    <input
                      type="text"
                      inputMode={type === 'number' ? 'decimal' : 'text'}
                      value={values[v] ?? ''}
                      onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
                      placeholder={`请输入${v}`}
                      className={`px-2 py-1.5 text-xs rounded-btn border bg-surface-2 ${
                        isMissing ? 'border-semantic-error' : 'border-border'
                      } text-text-primary`}
                    />
                  </label>
                );
              })
            )}
            {attempted && missing.length > 0 && (
              <div className="text-[10px] text-semantic-error" role="alert">
                还有 {missing.length} 个变量未填写：{missing.join('、')}，填写后才能生成
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={closeFill} className="ghost-btn px-3 py-1.5 text-xs">
                取消
              </button>
              <button
                type="button"
                onClick={confirmFill}
                className="primary-btn px-3 py-1.5 text-xs"
                aria-label="生成并插入输入框"
              >
                生成并插入 →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TemplateSaveDialogProps {
  /** 初始模板正文（结果页传入当前提示词 Markdown） */
  initialBody: string;
  defaultName?: string;
  onClose: () => void;
}

/**
 * 保存模板对话框（结果页「存为模板」入口）：
 * 编辑正文 + {{}} 插入按钮 + 变量实时预览 + 标签。
 */
export function TemplateSaveDialog({ initialBody, defaultName = '未命名模板', onClose }: TemplateSaveDialogProps) {
  const [name, setName] = useState(defaultName);
  const [body, setBody] = useState(initialBody);
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const previewVars = parseTemplateVariables(body);

  const insertPlaceholder = () => {
    const el = bodyRef.current;
    const token = '{{}}';
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    // 恢复焦点并把光标放进花括号内
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 2, start + 2);
    });
  };

  const onSave = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const tags = tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const tpl = buildUserTemplate({ name, body, tags });
      await saveTemplate({ name: tpl.name, body: tpl.body, tags: JSON.stringify(tpl.tags) });
      setSaved(true);
      // 保存成功后短暂停留再关闭，给用户确认反馈
      setTimeout(() => onClose(), 500);
    } catch (e) {
      console.warn('[TemplateSaveDialog] 保存模板失败', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-label="保存为模板"
    >
      <div className="w-[360px] max-h-[85vh] overflow-y-auto bg-surface rounded-xl border border-border p-4 flex flex-col gap-3">
        <div className="text-sm text-text-primary font-medium">保存为模板</div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">模板名称</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-btn border border-border bg-surface-2 text-text-primary"
            aria-label="模板名称"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">
            模板正文（把可变部分改成 {'{{变量名}}'}）
          </span>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="px-2 py-1.5 text-xs rounded-btn border border-border bg-surface-2 text-text-primary font-mono"
            aria-label="模板正文"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={insertPlaceholder}
            className="ghost-btn px-2 py-1 text-[10px]"
            title="在光标处插入 {{}} 占位符"
          >
            插入 {'{{}}'}
          </button>
          <span className="text-[10px] text-text-tertiary truncate">
            {previewVars.length > 0
              ? `识别到 ${previewVars.length} 个变量：${previewVars.join('、')}`
              : '暂无变量（纯文本模板也可保存）'}
          </span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-text-secondary">分类标签（逗号分隔，可选）</span>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="如：UI、后端"
            className="px-2 py-1.5 text-xs rounded-btn border border-border bg-surface-2 text-text-primary"
            aria-label="分类标签"
          />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="ghost-btn px-3 py-1.5 text-xs">
            取消
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || saved || body.trim() === ''}
            className="primary-btn px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {saved ? '已保存 ✓' : saving ? '保存中…' : '保存模板'}
          </button>
        </div>
      </div>
    </div>
  );
}
