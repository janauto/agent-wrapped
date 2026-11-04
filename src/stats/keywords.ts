// 本地关键词统计：去掉代码、链接、路径、标签后，用系统自带的 Intl.Segmenter 分词计数。
// 只保留计数结果，不保留原句。

const ZH_STOP = new Set(
  `一个 一下 一些 一样 一直 一起 不是 不要 不能 不会 不用 不过 也是 也不 了吗 什么 他们 以及 以后 以前 任何 但是 你们 你的 使用 其他 其中 具体 内容 再次 出来 可以 可能 各种 后面 吗吧 告诉 和你 因为 如何 如果 好的 就是 已经 帮我 应该 怎么 怎样 我们 我的 或者 所以 所有 才能 时候 是不是 是否 是的 有没有 有些 来说 没有 然后 现在 用户 由于 的话 看看 看下 知道 而且 自己 还是 还有 这个 这些 这样 这里 这次 进行 那个 那些 那么 那样 需要 非常 而是 一次 地方 东西 继续 直接 之后 之前 之类 部分 当前 目前 里面 上面 下面 对于 关于 通过 根据 为了 一般 比较 还要 这边 那边 起来 下去 并且 只是 只要 其实 确认 处理 问题 一份 两个 几个 为什么 么 吧 呢 啊 请帮 帮忙 情况 形式 信息 文件 以下 如下 一种 方式 相关 包括 内容 要求`.split(/\s+/),
);
const EN_STOP = new Set(
  `the and for with this that you are not can from have was use will your what all but get how just json true false null http https www com org net into then than when also more some any its our out new one two now let lets make sure should would could there here they them their which been were has had does did done like need want only each other about after before over under such these those very much many may might must shall yes okay ok please thanks file files line lines code run using used user users assistant below above following example input output text content message messages type name value data based provide system prompt response request`.split(
    /\s+/,
  ),
);

const STRIP = [
  /```[\s\S]*?```/g, // 代码块
  /`[^`\n]*`/g, // 行内代码
  /https?:\/\/\S+/g, // 链接
  /<[^>\n]{1,200}>/g, // 标签
  /(?:~|\.{0,2})?\/[\w.\-~/一-龥]+/g, // 路径
  /[\w.+-]+@[\w-]+\.[\w.]+/g, // 邮箱
  /\b[0-9a-f]{7,}\b/gi, // 哈希
];

/** 虚词、代词等单字，不参与拼候选词 */
const SINGLE_STOP = new Set([..."的了是在又也就都和与及我你他她它这那有没不很吗呢吧啊么个把被给让从到对为而且还再才只并或但如若要会能可想说看做去来上下中里后前一二三两几多少些"]);
/** 「挂了」「好的」这类带语气助词结尾的词 */
const PARTICLE_END = /[了的吗呢吧啊么着过]$/;

const HAN = /^[一-龥]+$/;
const LATIN = /^[A-Za-z][A-Za-z0-9+#-]*$/;

export class Keywords {
  private seg = new Intl.Segmenter("zh", { granularity: "word" });
  private counts = new Map<string, number>();

  add(text: string): void {
    let t = text.length > 4000 ? text.slice(0, 4000) : text; // 粘贴的大段日志只看开头
    for (const re of STRIP) t = t.replace(re, " ");
    const seen = new Set<string>(); // 一条消息里同一个词只算一次，避免刷屏
    const bump = (w: string) => {
      if (seen.has(w)) return;
      seen.add(w);
      this.counts.set(w, (this.counts.get(w) ?? 0) + 1);
    };
    // 系统词典不认识的专业词（如「固件」）会被拆成单字：把连续单字两两组成候选词，
    // 真词在全年里反复出现会排上来，偶然拼出的组合频次低会被挤掉。
    let run = "";
    const flush = () => {
      for (let i = 0; i + 1 < run.length; i++) {
        const bi = run.slice(i, i + 2);
        if (!SINGLE_STOP.has(bi[0]!) && !SINGLE_STOP.has(bi[1]!) && !ZH_STOP.has(bi)) bump(bi);
      }
      run = "";
    };
    for (const { segment, isWordLike } of this.seg.segment(t)) {
      let w = segment.trim();
      if (isWordLike && w.length === 1 && HAN.test(w)) {
        run += w;
        continue;
      }
      flush();
      if (!isWordLike) continue;
      if (HAN.test(w)) {
        if (w.length < 2 || ZH_STOP.has(w) || PARTICLE_END.test(w)) continue;
      } else if (LATIN.test(w)) {
        w = w.length <= 4 && w === w.toUpperCase() ? w : w.toLowerCase(); // 保留 API、BLE 这类缩写
        if (w.length < 3 || EN_STOP.has(w.toLowerCase())) continue;
      } else continue;
      bump(w);
    }
    flush();
  }

  top(n: number): Array<{ word: string; count: number }> {
    return [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([word, count]) => ({ word, count }));
  }
}
