import { TemplateSchema, type Template, type TemplateName } from '@aplikaacja/shared';
import starter from '../../../../templates/starter.json';

/** Bundled with the Worker; validated once per isolate (templateProblems runs in CI). */
const SOURCES: Record<TemplateName, unknown> = { starter };
const parsed = new Map<TemplateName, Template>();

export function loadTemplate(name: TemplateName): Template {
  let template = parsed.get(name);
  if (!template) {
    template = TemplateSchema.parse(SOURCES[name]);
    parsed.set(name, template);
  }
  return template;
}
