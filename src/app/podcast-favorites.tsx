import { SettingsPage } from '@/components/SettingsUI';
import { PodcastLibrary } from '@/components/PodcastLibrary';
import { useT } from '@/i18n';
export default function PodcastFavoritesScreen() {
  const t = useT();
  return <SettingsPage title={t('Podcasts')}><PodcastLibrary /></SettingsPage>;
}
