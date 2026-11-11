import { InlineKeyboardMarkup, InlineKeyboardButton } from 'grammy/types';
import { escapeHtml } from './formatters';

export type ButtonStyle = 'primary' | 'success' | 'danger' | 'link';
export type ButtonAlign = 'left' | 'center' | 'right';

export interface BotApi103ButtonOptions {
  style?: ButtonStyle;
  disabled?: boolean;
  iconCustomEmojiId?: string;
}

export type BotApi103InlineButton = InlineKeyboardButton & {
  style?: Exclude<ButtonStyle, 'link'>;
  disabled?: Record<string, never>;
  icon_custom_emoji_id?: string;
};

interface RichRowEntry {
  align: ButtonAlign;
  buttons: Array<{
    text: string;
    type: 'callback_data' | 'url' | 'copy_text' | 'disabled';
    payload?: string;
    style?: ButtonStyle;
    disabled?: boolean;
  }>;
}

/**
 * Bot API 10.3 Button Builder ("Button Revolution").
 * Supports:
 * - Native button styles: 'primary' (blue), 'success' (green), 'danger' (red), 'link'
 * - Native DisabledButton (`disabled: {}`) for active tabs, locked states, and completed actions
 * - Native CopyTextButton (`copy_text: { text }`) for one-tap clipboard copy
 * - Custom row alignment (`left`, `center`, `right`) and `<tg-button-row>` Rich Message HTML generation
 */
export class SmartKeyboard {
  private rows: BotApi103InlineButton[][] = [[]];
  private richRows: RichRowEntry[] = [{ align: 'center', buttons: [] }];

  private currentRow(): BotApi103InlineButton[] {
    if (this.rows.length === 0) {
      this.rows.push([]);
    }
    return this.rows[this.rows.length - 1];
  }

  private currentRichRow(): RichRowEntry {
    if (this.richRows.length === 0) {
      this.richRows.push({ align: 'center', buttons: [] });
    }
    return this.richRows[this.richRows.length - 1];
  }

  private applyCommonFields(
    btn: Record<string, unknown>,
    options?: BotApi103ButtonOptions
  ): BotApi103InlineButton {
    if (options?.style && options.style !== 'link') {
      btn.style = options.style;
    }
    if (options?.iconCustomEmojiId) {
      btn.icon_custom_emoji_id = options.iconCustomEmojiId;
    }
    return btn as unknown as BotApi103InlineButton;
  }

  /**
   * Adds a callback button (or converts it into a Bot API 10.3 DisabledButton if `options.disabled` is true).
   */
  public callback(
    text: string,
    data: string,
    options?: BotApi103ButtonOptions
  ): this {
    if (options?.disabled) {
      return this.disabled(text, options);
    }

    const btn = this.applyCommonFields(
      {
        text,
        callback_data: data,
      },
      options
    );
    this.currentRow().push(btn);
    this.currentRichRow().buttons.push({
      text,
      type: 'callback_data',
      payload: data,
      style: options?.style,
    });
    return this;
  }

  /**
   * Adds a URL button with optional Bot API 10.3 styling.
   */
  public url(text: string, url: string, options?: BotApi103ButtonOptions): this {
    if (options?.disabled) {
      return this.disabled(text, options);
    }

    const btn = this.applyCommonFields(
      {
        text,
        url,
      },
      options
    );
    this.currentRow().push(btn);
    this.currentRichRow().buttons.push({
      text,
      type: 'url',
      payload: url,
      style: options?.style,
    });
    return this;
  }

  /**
   * Adds a native copy_text button that copies `textToCopy` to the user's clipboard in one tap.
   */
  public copyText(
    text: string,
    textToCopy: string,
    options?: BotApi103ButtonOptions
  ): this {
    if (options?.disabled) {
      return this.disabled(text, options);
    }

    const btn = this.applyCommonFields(
      {
        text,
        copy_text: { text: textToCopy.slice(0, 256) },
      },
      options
    );
    this.currentRow().push(btn);
    this.currentRichRow().buttons.push({
      text,
      type: 'copy_text',
      payload: textToCopy.slice(0, 256),
      style: options?.style,
    });
    return this;
  }

  /**
   * Adds a Bot API 10.3 DisabledButton (`disabled: {}`) that renders as non-interactive in Telegram.
   */
  public disabled(text: string, options?: Omit<BotApi103ButtonOptions, 'disabled'>): this {
    const btn = this.applyCommonFields(
      {
        text,
        disabled: {},
      },
      options
    );
    this.currentRow().push(btn);
    this.currentRichRow().buttons.push({
      text,
      type: 'disabled',
      style: options?.style,
      disabled: true,
    });
    return this;
  }

  /**
   * Starts a new button row with optional horizontal alignment (`left`, `center`, `right`).
   */
  public row(align: ButtonAlign = 'center'): this {
    if (this.currentRow().length > 0) {
      this.rows.push([]);
      this.richRows.push({ align, buttons: [] });
    } else {
      this.currentRichRow().align = align;
    }
    return this;
  }

  /**
   * Builds standard InlineKeyboardMarkup with Bot API 10.3 extensions (`style`, `disabled`, `copy_text`).
   */
  public toMarkup(): InlineKeyboardMarkup {
    const nonEmptyRows = this.rows.filter((r) => r.length > 0);
    return {
      inline_keyboard: nonEmptyRows,
    };
  }

  /**
   * Renders `<tg-button-row>` and `<tg-button>` HTML blocks for Bot API 10.3 Rich Messages.
   */
  public toRichHtml(): string {
    const nonEmpty = this.richRows.filter((r) => r.buttons.length > 0);
    return nonEmpty
      .map((row) => {
        const btns = row.buttons
          .map((b) => {
            const attrs: string[] = [];
            if (b.style) {
              attrs.push(`style="${b.style}"`);
            }
            if (b.disabled || b.type === 'disabled') {
              attrs.push('disabled="true"');
            } else if (b.type === 'callback_data' && b.payload) {
              attrs.push('type="callback_data"', `data="${escapeHtml(b.payload)}"`);
            } else if (b.type === 'url' && b.payload) {
              attrs.push('type="url"', `url="${escapeHtml(b.payload)}"`);
            } else if (b.type === 'copy_text' && b.payload) {
              attrs.push('type="copy_text"', `text="${escapeHtml(b.payload)}"`);
            }
            const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
            return `  <tg-button${attrStr}>${escapeHtml(b.text)}</tg-button>`;
          })
          .join('\n');
        return `<tg-button-row align="${row.align}">\n${btns}\n</tg-button-row>`;
      })
      .join('\n');
  }
}

