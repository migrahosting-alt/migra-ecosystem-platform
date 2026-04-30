export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'color'
  | 'select'
  | 'toggle'
  | 'spacing'
  | 'typography'
  | 'media';

export type WidgetField =
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string; rows?: number }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number }
  | { kind: 'color'; key: string; label: string }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: Array<{ label: string; value: string | number }> }
  | { kind: 'media'; key: string; label: string; libraryType?: 'image' | 'any' }
  | {
      kind: 'spacing';
      key: string;
      label: string;
      keys: { top: string; right: string; bottom: string; left: string; linked?: string };
      min?: number;
      max?: number;
      step?: number;
      help?: string;
    }
  | {
      kind: 'typography';
      key: string;
      label: string;
      keys: { size: string; weight: string; lineHeight?: string; letterSpacing?: string; align?: string };
      size?: { min?: number; max?: number; step?: number };
      lineHeight?: { min?: number; max?: number; step?: number };
      letterSpacing?: { min?: number; max?: number; step?: number };
      help?: string;
    };

export type WidgetDefinition = {
  type: string;
  title: string;
  category: string;
  defaults: Record<string, any>;
  fields: WidgetField[];
};

export const WIDGETS: Record<string, WidgetDefinition> = {
  section: {
    type: 'section',
    title: 'Section',
    category: 'layout',
    defaults: {
      content_width: 'boxed',
      width: 1140,
      gap: 20,
      background_color: '',
      padding_top: 0,
      padding_bottom: 0,
    },
    fields: [
      {
        kind: 'select',
        key: 'content_width',
        label: 'Content Width',
        options: [
          { label: 'Boxed', value: 'boxed' },
          { label: 'Full Width', value: 'full' },
        ],
      },
      { kind: 'number', key: 'width', label: 'Box Width', min: 600, max: 2000, step: 10 },
      { kind: 'number', key: 'gap', label: 'Gap', min: 0, max: 200, step: 1 },
      { kind: 'color', key: 'background_color', label: 'Background' },
      { kind: 'number', key: 'padding_top', label: 'Padding Top', min: 0, max: 400, step: 1 },
      { kind: 'number', key: 'padding_bottom', label: 'Padding Bottom', min: 0, max: 400, step: 1 },
    ],
  },
  container: {
    type: 'container',
    title: 'Container',
    category: 'layout',
    defaults: {
      gap: 20,
      background_color: '',
      padding_top: 0,
      padding_bottom: 0,
      css_id: '',
      css_classes: '',
    },
    fields: [
      { kind: 'number', key: 'gap', label: 'Gap', min: 0, max: 200, step: 1 },
      { kind: 'color', key: 'background_color', label: 'Background' },
      { kind: 'number', key: 'padding_top', label: 'Padding Top', min: 0, max: 400, step: 1 },
      { kind: 'number', key: 'padding_bottom', label: 'Padding Bottom', min: 0, max: 400, step: 1 },
    ],
  },
  heading: {
    type: 'heading',
    title: 'Heading',
    category: 'basic',
    defaults: {
      title: 'Heading',
      tag: 'h2',
      color: '#0f172a',
      font_size: 48,
      font_weight: '600',
      line_height: 1.15,
      letter_spacing: 0,
      align: 'left',
      padding_top: 0,
      padding_right: 0,
      padding_bottom: 0,
      padding_left: 0,
      padding_linked: true,
    },
    fields: [
      { kind: 'textarea', key: 'title', label: 'Text', placeholder: 'Headline…', rows: 3 },
      {
        kind: 'select',
        key: 'tag',
        label: 'Tag',
        options: [
          { label: 'H1', value: 'h1' },
          { label: 'H2', value: 'h2' },
          { label: 'H3', value: 'h3' },
          { label: 'H4', value: 'h4' },
          { label: 'H5', value: 'h5' },
          { label: 'H6', value: 'h6' },
        ],
      },
      { kind: 'color', key: 'color', label: 'Text Color' },
      {
        kind: 'spacing',
        key: 'padding',
        label: 'Padding',
        keys: {
          top: 'padding_top',
          right: 'padding_right',
          bottom: 'padding_bottom',
          left: 'padding_left',
          linked: 'padding_linked',
        },
        min: 0,
        max: 240,
        step: 1,
        help: 'Inner spacing',
      },
      {
        kind: 'typography',
        key: 'typography',
        label: 'Typography',
        keys: {
          size: 'font_size',
          weight: 'font_weight',
          lineHeight: 'line_height',
          letterSpacing: 'letter_spacing',
          align: 'align',
        },
        size: { min: 8, max: 160, step: 1 },
        lineHeight: { min: 0.8, max: 3, step: 0.05 },
        letterSpacing: { min: -5, max: 15, step: 0.1 },
        help: 'Size, weight, spacing, alignment',
      },
    ],
  },
  'text-editor': {
    type: 'text-editor',
    title: 'Text Editor',
    category: 'basic',
    defaults: {
      editor: 'Add your text here…',
      align: 'left',
    },
    fields: [
      { kind: 'textarea', key: 'editor', label: 'Text', placeholder: 'Write something…', rows: 6 },
      {
        kind: 'select',
        key: 'align',
        label: 'Align',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'right' },
        ],
      },
      { kind: 'color', key: 'color', label: 'Text Color' },
    ],
  },
  image: {
    type: 'image',
    title: 'Image',
    category: 'basic',
    defaults: {
      image: { url: '', id: 0 },
      caption: '',
      link: '',
      align: 'center',
      size: 'full',
    },
    fields: [
      { kind: 'media', key: 'image', label: 'Image', libraryType: 'image' },
      { kind: 'text', key: 'caption', label: 'Caption', placeholder: 'Optional caption' },
      { kind: 'text', key: 'link', label: 'Link', placeholder: 'https://… or #' },
      {
        kind: 'select',
        key: 'align',
        label: 'Align',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'right' },
        ],
      },
    ],
  },
  button: {
    type: 'button',
    title: 'Button',
    category: 'basic',
    defaults: {
      text: 'Request a Quote',
      link: '#',
      type: 'primary',
      size: 'medium',
      align: 'left',
      icon: '',
      icon_position: 'left',
    },
    fields: [
      { kind: 'text', key: 'text', label: 'Label', placeholder: 'Button label' },
      { kind: 'text', key: 'link', label: 'Link', placeholder: 'https://… or #' },
      {
        kind: 'select',
        key: 'type',
        label: 'Type',
        options: [
          { label: 'Primary', value: 'primary' },
          { label: 'Secondary', value: 'secondary' },
          { label: 'Link', value: 'link' },
        ],
      },
      {
        kind: 'select',
        key: 'align',
        label: 'Align',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'right' },
        ],
      },
    ],
  },
  'site-logo': {
    type: 'site-logo',
    title: 'Site Logo',
    category: 'theme-elements',
    defaults: {
      mode: 'wp',
      image: { url: '', id: 0 },
      align: 'left',
      size: 48,
    },
    fields: [
      {
        kind: 'select',
        key: 'mode',
        label: 'Source',
        options: [
          { label: 'Use WordPress Custom Logo', value: 'wp' },
          { label: 'Custom (this page only)', value: 'custom' },
        ],
      },
      { kind: 'media', key: 'image', label: 'Custom Logo', libraryType: 'image' },
      {
        kind: 'select',
        key: 'align',
        label: 'Align',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'right' },
        ],
      },
      { kind: 'number', key: 'size', label: 'Size', min: 16, max: 240, step: 1 },
    ],
  },
  divider: {
    type: 'divider',
    title: 'Divider',
    category: 'basic',
    defaults: {
      style: 'solid',
      weight: 1,
      color: '#e2e8f0',
      width: 100,
      align: 'center',
    },
    fields: [
      {
        kind: 'select',
        key: 'style',
        label: 'Style',
        options: [
          { label: 'Solid', value: 'solid' },
          { label: 'Dashed', value: 'dashed' },
          { label: 'Dotted', value: 'dotted' },
        ],
      },
      { kind: 'number', key: 'weight', label: 'Weight', min: 1, max: 12, step: 1 },
      { kind: 'color', key: 'color', label: 'Color' },
      { kind: 'number', key: 'width', label: 'Width (%)', min: 1, max: 100, step: 1 },
      {
        kind: 'select',
        key: 'align',
        label: 'Align',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'right' },
        ],
      },
    ],
  },
  spacer: {
    type: 'spacer',
    title: 'Spacer',
    category: 'basic',
    defaults: { height: 40 },
    fields: [{ kind: 'number', key: 'height', label: 'Height', min: 0, max: 600, step: 1 }],
  },
  counter: {
    type: 'counter',
    title: 'Counter',
    category: 'general',
    defaults: {
      title: '',
      start: 0,
      end: 100,
      duration: 2000,
      prefix: '',
      suffix: '',
      color: '#F8FAFC',
    },
    fields: [
      { kind: 'text', key: 'title', label: 'Title', placeholder: 'Optional label' },
      { kind: 'number', key: 'start', label: 'Start', min: -1000000, max: 1000000, step: 1 },
      { kind: 'number', key: 'end', label: 'End', min: -1000000, max: 1000000, step: 1 },
      { kind: 'number', key: 'duration', label: 'Duration (ms)', min: 100, max: 20000, step: 50 },
      { kind: 'text', key: 'prefix', label: 'Prefix', placeholder: '$' },
      { kind: 'text', key: 'suffix', label: 'Suffix', placeholder: '+' },
      { kind: 'color', key: 'color', label: 'Color' },
    ],
  },
  progress: {
    type: 'progress',
    title: 'Progress Bar',
    category: 'general',
    defaults: {
      title: '',
      percent: 50,
      color: '#6366f1',
    },
    fields: [
      { kind: 'text', key: 'title', label: 'Title', placeholder: 'Optional title' },
      { kind: 'number', key: 'percent', label: 'Percent', min: 0, max: 100, step: 1 },
      { kind: 'color', key: 'color', label: 'Color' },
    ],
  },
  testimonial: {
    type: 'testimonial',
    title: 'Testimonial',
    category: 'general',
    defaults: {
      content: '“Migra is amazing.”',
      name: 'Jane Doe',
      title: 'CEO',
    },
    fields: [
      { kind: 'textarea', key: 'content', label: 'Content', rows: 5 },
      { kind: 'text', key: 'name', label: 'Name' },
      { kind: 'text', key: 'title', label: 'Title' },
    ],
  },
};

export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGETS[type];
}
