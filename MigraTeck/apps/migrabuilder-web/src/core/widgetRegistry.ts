import type { Component } from 'vue';

import WidgetSection from '@/components/widgets/WidgetSection.vue';
import WidgetContainer from '@/components/widgets/WidgetContainer.vue';
import WidgetHeading from '@/components/widgets/WidgetHeading.vue';
import WidgetTextEditor from '@/components/widgets/WidgetTextEditor.vue';
import WidgetImage from '@/components/widgets/WidgetImage.vue';
import WidgetButton from '@/components/widgets/WidgetButton.vue';
import WidgetDivider from '@/components/widgets/WidgetDivider.vue';
import WidgetSpacer from '@/components/widgets/WidgetSpacer.vue';
import WidgetCounter from '@/components/widgets/WidgetCounter.vue';
import WidgetProgress from '@/components/widgets/WidgetProgress.vue';
import WidgetTestimonial from '@/components/widgets/WidgetTestimonial.vue';
import WidgetSiteLogo from '@/components/widgets/WidgetSiteLogo.vue';

const REGISTRY: Record<string, Component> = {
  section: WidgetSection,
  container: WidgetContainer,
  heading: WidgetHeading,
  'text-editor': WidgetTextEditor,
  image: WidgetImage,
  button: WidgetButton,
  'site-logo': WidgetSiteLogo,
  divider: WidgetDivider,
  spacer: WidgetSpacer,
  counter: WidgetCounter,
  progress: WidgetProgress,
  testimonial: WidgetTestimonial,
};

export function getWidgetRenderer(type: string): Component | null {
  return REGISTRY[type] || null;
}
