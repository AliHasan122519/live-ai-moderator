'use client';
import { PRIVACY_AR, useApi } from '@/lib/api';
import { Badge, Card, Notice, PageTitle, Spinner } from '@/components/ui';

export default function Settings() {
  const acc = useApi<any>('/api/account'); const dash = useApi<any>('/api/dashboard');
  if (acc.loading || dash.loading) return <Spinner />;
  const a = acc.data?.account; const i = a?.creatorInfo;
  const row = (k: string, v: React.ReactNode) => <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2.5 text-sm last:border-0"><span className="text-muted">{k}</span><span className="text-end">{v}</span></div>;
  return (
    <div className="space-y-4">
      <PageTitle sub="هذه القيم تأتي من TikTok مباشرة (creator_info) ولا يمكن تجاوزها">إعدادات النشر</PageTitle>
      {!a ? <Notice tone="warn">اربط حساب TikTok أولاً.</Notice> : <>
        <Card>{row('الخصوصية المسموحة', i?.privacy_level_options?.map((o: string) => PRIVACY_AR[o] ?? o).join('، ') ?? '—')}
          {row('التعليقات', i?.comment_disabled ? <Badge tone="warn">معطّلة من حسابك</Badge> : 'مسموحة')}
          {row('ديو', i?.duet_disabled ? <Badge tone="warn">معطّل من حسابك</Badge> : 'مسموح')}
          {row('ستيتش', i?.stitch_disabled ? <Badge tone="warn">معطّل من حسابك</Badge> : 'مسموح')}
          {row('أقصى مدة فيديو', i?.max_video_post_duration_sec ? `${Math.round(i.max_video_post_duration_sec / 60)} دقيقة` : '—')}</Card>
        <Card>{row('النشر المباشر', a.scopes.includes('video.publish') ? 'متاح' : 'غير متاح (مسودة فقط)')}{row('مراجعة التطبيق', a.audited ? 'معتمد' : 'غير معتمد (خصوصية «أنا فقط» مفروضة)')}</Card>
      </>}
      <Card>{row('توليد الأوصاف بالذكاء الاصطناعي', dash.data?.ai ? <Badge tone="ok">مفعّل</Badge> : <Badge tone="mute">غير مفعّل</Badge>)}{row('المنطقة الزمنية للجدولة', 'Asia/Riyadh')}</Card>
      <Notice tone="info">متطلبات TikTok: يجب اختيار الخصوصية يدوياً في كل منشور، وعدم تجاوز إعدادات حسابك. التطبيق يلتزم بذلك.</Notice>
    </div>
  );
}
