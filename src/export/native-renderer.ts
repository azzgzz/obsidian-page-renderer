import { App, Component, MarkdownRenderer } from "obsidian";

const POST_PROCESSOR_TIMEOUT = 5000;
const DEBOUNCE_INTERVAL = 200;

export interface RenderDomOptions {
	timeout?: number;
	/** Extra readiness check applied after the DOM has been quiet for the debounce interval. */
	isReady?: (container: HTMLElement) => boolean;
}

/**
 * Renders markdown into a hidden container, waits for async post-processors
 * (Dataview, Tasks) and hands the live container to `read` before it is torn
 * down. Reading live nodes keeps state that `innerHTML` drops, e.g. the
 * `checked` property of checkboxes.
 */
export async function renderMarkdownDom<T>(
	app: App,
	markdown: string,
	sourcePath: string,
	read: (container: HTMLElement) => T,
	options: RenderDomOptions = {},
): Promise<{ value: T; timedOut: boolean }> {
	const container = activeDocument.body.createDiv();
	container.setCssProps({
		position: "fixed",
		left: "-9999px",
		top: "-9999px",
		width: "800px",
		visibility: "hidden",
	});

	const component = new Component();
	component.load();

	try {
		await MarkdownRenderer.render(app, markdown, container, sourcePath, component);
		const completed = await waitForPostProcessors(
			container,
			options.timeout ?? POST_PROCESSOR_TIMEOUT,
			options.isReady,
		);
		return { value: read(container), timedOut: !completed };
	} finally {
		component.unload();
		container.remove();
	}
}

export async function waitForPostProcessors(
	el: HTMLElement,
	timeout: number,
	isReady?: (el: HTMLElement) => boolean,
): Promise<boolean> {
	return new Promise((resolve) => {
		let timer: number | undefined;
		let overallTimer: number | undefined;

		const clearTimer = (timerId: number | undefined) => {
			if (timerId !== undefined) {
				window.clearTimeout(timerId);
			}
		};

		// A quiet DOM is only "done" when the caller agrees; otherwise keep
		// polling until the overall timeout.
		const settle = () => {
			if (isReady && !isReady(el)) {
				timer = window.setTimeout(settle, DEBOUNCE_INTERVAL);
				return;
			}
			observer.disconnect();
			clearTimer(overallTimer);
			resolve(true);
		};

		const observer = new MutationObserver(() => {
			clearTimer(timer);
			timer = window.setTimeout(settle, DEBOUNCE_INTERVAL);
		});

		observer.observe(el, { childList: true, subtree: true, attributes: true });

		// Initial debounce in case no mutations fire (rendering already complete)
		timer = window.setTimeout(settle, DEBOUNCE_INTERVAL);

		// Overall timeout safety net
		overallTimer = window.setTimeout(() => {
			observer.disconnect();
			clearTimer(timer);
			resolve(false);
		}, timeout);
	});
}
