/**
 * A display-only `bpmn-js` renderer that shows a friendly label for UiPath
 * trigger start events.
 *
 * UiPath Maestro stores a trigger's TYPE id (e.g. `core.trigger.manual`) in the
 * start event's `name`. This renderer overrides only the drawing of that
 * element's external label, substituting a human-readable string. It never
 * touches `businessObject.name`, so the model — and therefore the saved `.bpmn`
 * file via `saveXML` — is unchanged.
 *
 * It is registered as a bpmn-js `additionalModule`, runs at a priority above
 * the stock `BpmnRenderer`, and `canRender`s only trigger-typed start-event
 * labels; every other element falls through to the default renderer.
 */
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type { ElementLike, ShapeLike } from 'diagram-js/lib/core/Types';
import { append as svgAppend, classes as svgClasses } from 'tiny-svg';
import { isTriggerTypeId, triggerDisplayLabel } from './triggerLabels';

/** Above the stock `BpmnRenderer` (priority 1000) so this `canRender` wins. */
const RENDER_PRIORITY = 1500;

/** The diagram-js label element this renderer inspects. */
interface LabelElement {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  businessObject?: { name?: string };
  labelTarget?: { type?: string };
}

/** The subset of the diagram-js `textRenderer` service this renderer uses. */
interface TextRenderer {
  createText(text: string, options: Record<string, unknown>): SVGElement;
  getExternalStyle(): Record<string, unknown>;
}

/** The `name` of the element a label belongs to, or `''`. */
function labelName(element: LabelElement): string {
  return element.businessObject?.name ?? '';
}

/**
 * Builds the bpmn-js `additionalModule` for the trigger-label renderer. It is
 * built per Modeler so the active theme's label colour is captured — the
 * Modeler is rebuilt on a VS Code theme switch.
 */
export function createTriggerLabelRendererModule(labelColor: string): Record<string, unknown> {
  class TriggerLabelRenderer extends BaseRenderer {
    public static $inject = ['eventBus', 'textRenderer'];

    private readonly textRenderer: TextRenderer;

    public constructor(eventBus: EventBus, textRenderer: TextRenderer) {
      super(eventBus, RENDER_PRIORITY);
      this.textRenderer = textRenderer;
    }

    public canRender(element: ElementLike): boolean {
      const el = element as unknown as LabelElement;
      return (
        !!el &&
        el.type === 'label' &&
        el.labelTarget?.type === 'bpmn:StartEvent' &&
        isTriggerTypeId(labelName(el))
      );
    }

    public drawShape(parentGfx: SVGElement, shape: ShapeLike): SVGElement {
      const el = shape as unknown as LabelElement;
      // Mirror bpmn-js' own renderExternalLabel geometry.
      const box = {
        width: el.width,
        height: el.height,
        x: el.width / 2 + el.x,
        y: el.height / 2 + el.y
      };
      const text = this.textRenderer.createText(triggerDisplayLabel(labelName(el)), {
        box,
        size: { width: 100 },
        style: { ...this.textRenderer.getExternalStyle(), fill: labelColor }
      });
      svgClasses(text).add('djs-label');
      svgAppend(parentGfx, text);
      return text;
    }
  }

  return {
    __init__: ['triggerLabelRenderer'],
    triggerLabelRenderer: ['type', TriggerLabelRenderer]
  };
}
