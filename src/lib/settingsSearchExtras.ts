import type { SettingsSearchEntry } from './settingsSearch';
import { normalizeSettingsQuery } from './settingsSearch';
/** New/custom controls may opt into the same registry without regenerating other entries. */
export const SETTINGS_SEARCH_EXTRAS: SettingsSearchEntry[] = [];

/** Common Chinese spellings, tone-free pinyin and initialisms. Applied to both UI languages. */
export const SETTINGS_SEARCH_ALIASES: { terms: string[]; aliases: string[] }[] = [
  { terms: ['玻璃', 'glass'], aliases: ['boli', 'bl', 'liquidglass', '毛玻璃', '液态玻璃', '调节室', '调解室'] },
  { terms: ['模糊', 'blur'], aliases: ['mohu', 'mh', '虚化', 'xuhua'] },
  { terms: ['折射', 'refraction', 'lens'], aliases: ['zheshe', 'zs', '透镜', 'toujing'] },
  { terms: ['播放', 'player', 'playback'], aliases: ['bofang', 'bf', 'bofangqi', 'bfq', '播放器'] },
  { terms: ['歌词', 'lyric'], aliases: ['geci', 'gc', '字幕', 'zimu'] },
  { terms: ['音质', 'quality', 'bitrate', 'codec'], aliases: ['yinzhi', 'yz', '码率', '无损', 'wusun', 'flac', 'aac', 'opus'] },
  { terms: ['下载', 'download'], aliases: ['xiazai', 'xz', '缓存', 'huancun', 'hc', '离线', 'lixian', 'lx'] },
  { terms: ['主题', 'theme', 'appearance', 'accent'], aliases: ['zhuti', 'zt', 'waiguan', 'wg', '颜色', 'yanse', 'ys', '取色', 'quse'] },
  { terms: ['深色', 'dark', 'light', 'schedule'], aliases: ['shense', 'qianse', '夜间', 'yejian', '白天', 'baitian', '深浅模式'] },
  { terms: ['字体', 'font'], aliases: ['ziti', 'zt', '字号', 'zihao', '粗细', 'cuxi'] },
  { terms: ['首页', 'home', 'greeting'], aliases: ['shouye', 'sy', 'wenhou', '问候', '标题', 'biaoti'] },
  { terms: ['导航', 'navigation', 'tab'], aliases: ['daohang', 'dh', '底栏', 'dilan', 'bottomtabs', '底部导航'] },
  { terms: ['迷你', 'mini'], aliases: ['miniplayer', '小播放器', 'minibofangqi'] },
  { terms: ['音量', 'volume'], aliases: ['yinliang', 'yl', '声音', 'shengyin'] },
  { terms: ['网络', 'network', 'server'], aliases: ['wangluo', 'wl', 'fuwuqi', 'fwq', '服务器', '连接', 'lianjie'] },
  { terms: ['语言', 'language'], aliases: ['yuyan', 'yy', '中文', 'zhongwen', 'chinese', 'english'] },
  { terms: ['导入', 'import', 'export', 'backup'], aliases: ['daoru', 'daochu', '备份', 'beifen', '恢复', 'huifu'] },
  { terms: ['随机', 'shuffle'], aliases: ['suiji', 'sj', '权重', 'quanzhong', '加权'] },
  { terms: ['队列', 'queue'], aliases: ['duilie', 'dl', '下一首', 'xiayishou'] },
  { terms: ['长音频', 'long audio', 'book', 'resume'], aliases: ['asmr', 'changyinpin', '书签', 'shuqian', '续播', 'xubo'] },
  { terms: ['诊断', 'diagnostic'], aliases: ['zhenduan', 'zd', '日志', 'rizhi', '故障', 'guzhang'] },
  { terms: ['均衡', 'equalizer'], aliases: ['junhengqi', 'jhq', 'eq'] },
  { terms: ['睡眠', 'sleep'], aliases: ['shuimian', 'dingshi', '定时', '助眠'] },
];

export function withSettingsSearchAliases(entry: SettingsSearchEntry): SettingsSearchEntry {
  const names = normalizeSettingsQuery(`${entry.title}${entry.chinese}${entry.section}`);
  const aliases = SETTINGS_SEARCH_ALIASES.filter((group) => group.terms.some((term) => names.includes(normalizeSettingsQuery(term))))
    .flatMap((group) => group.aliases);
  if (names.includes('lyric') && names.includes('blur')) aliases.push('歌词模糊', '模糊歌词', 'gecimohu', 'gcmh');
  return { ...entry, aliases: [...(entry.aliases ?? []), ...aliases] };
}
