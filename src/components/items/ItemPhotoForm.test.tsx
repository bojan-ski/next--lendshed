import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { uploadItemPhoto } from "@/actions/photos";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { preparePhotoForUpload } from "@/lib/photos/prepare";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { photos } from "@/strings/photos";
import type { ItemPhotoState } from "@/types/photo";
import ItemPhotoForm from "./ItemPhotoForm";

vi.mock("@/actions/photos", () => ({ uploadItemPhoto: vi.fn() }));
vi.mock("@/lib/photos/prepare", () => ({ preparePhotoForUpload: vi.fn() }));

const prepared = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
const picked = new File(["raw"], "IMG_0001.HEIC.jpg", { type: "image/jpeg" });
const photo = { url: "/uploads/items/a.webp", width: 1200, height: 900 };
const PROPS = { itemId: "item-1", title: "Ladder", photo: null };

// jsdom has no object URLs: only the two statics, URL itself stays real.
let objectUrls = 0;
beforeEach(() => {
  objectUrls = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrls}`);
  URL.revokeObjectURL = vi.fn();
  vi.mocked(preparePhotoForUpload).mockResolvedValue({
    kind: "ready",
    blob: prepared,
  });
});

afterEach(() => {
  act(() => dismissToast());
});

const control = (name: string = photos.choose) => screen.getByLabelText(name);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ItemPhotoForm", () => {
  test("no photo: the placeholder and a primary Choose a photo", () => {
    render(<ItemPhotoForm {...PROPS} />);

    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
    expect(control()).toHaveAttribute("type", "file");
    expect(control()).toHaveAttribute("accept", "image/*");
    expect(control().closest("label")).toHaveClass("bg-accent");
    expect(screen.getByText(photos.guidance)).toBeInTheDocument();
  });

  test("with a photo: the preview and an outline Choose another photo", () => {
    render(<ItemPhotoForm {...PROPS} photo={photo} />);

    expect(
      screen.getByRole("img", {
        name: t(photos.previewAlt, { title: "Ladder" }),
      }),
    ).toBeInTheDocument();
    expect(control(photos.chooseAnother).closest("label")).not.toHaveClass(
      "bg-accent",
    );
  });

  test("before hydration the control is disabled and says JavaScript is needed", () => {
    const html = renderToString(<ItemPhotoForm {...PROPS} />);
    expect(html).toContain(photos.needsJavaScript);
    expect(html).toMatch(/<input[^>]*disabled/);

    render(<ItemPhotoForm {...PROPS} />);
    expect(screen.queryByText(photos.needsJavaScript)).toBeNull();
    expect(control()).toBeEnabled();
  });

  test("picking a photo prepares it and sends it at once, with the item id", async () => {
    vi.mocked(uploadItemPhoto).mockResolvedValue({ flash: "photoSaved" });
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);

    await vi.waitFor(() => expect(uploadItemPhoto).toHaveBeenCalledTimes(1));
    expect(preparePhotoForUpload).toHaveBeenCalledWith(picked);
    const sent = vi.mocked(uploadItemPhoto).mock.calls[0][1];
    expect(sent.get("id")).toBe("item-1");
    const file = sent.get("photo") as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(prepared.size);
  });

  test("a client-side failure shows a focused notice and sends nothing", async () => {
    vi.mocked(preparePhotoForUpload).mockResolvedValue({ kind: "failed" });
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);

    const notice = await screen.findByText(photos.clientFailed);
    expect(notice.closest('[role="alert"]')).toBeNull();
    await vi.waitFor(() => expect(notice.closest("[tabindex]")).toHaveFocus());
    expect(uploadItemPhoto).not.toHaveBeenCalled();
  });

  test("while working: status lines, a disabled control, no spinner", async () => {
    const preparing = deferred<{ kind: "ready"; blob: Blob }>();
    const saving = deferred<ItemPhotoState>();
    vi.mocked(preparePhotoForUpload).mockReturnValue(preparing.promise);
    vi.mocked(uploadItemPhoto).mockReturnValue(saving.promise);
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);
    expect(await screen.findByRole("status")).toHaveTextContent(
      photos.preparing,
    );
    expect(control()).toBeDisabled();

    await act(async () => preparing.resolve({ kind: "ready", blob: prepared }));
    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(photos.saving),
    );
    expect(control()).toBeDisabled();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(
      screen.getByRole("img", {
        name: t(photos.previewAlt, { title: "Ladder" }),
      }),
    ).toHaveAttribute("src", "blob:preview-1");

    await act(async () => saving.resolve({ flash: "photoSaved" }));
    await vi.waitFor(() => expect(control()).toBeEnabled());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  test("success toasts photoSaved", async () => {
    vi.mocked(uploadItemPhoto).mockResolvedValue({ flash: "photoSaved" });
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);

    await vi.waitFor(() => expect(getActiveToast()?.key).toBe("photoSaved"));
  });

  test("after a save, focus returns to the control", async () => {
    // jsdom keeps focus on a control that becomes disabled; a browser drops it.
    vi.mocked(uploadItemPhoto).mockImplementation(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      return { flash: "photoSaved" };
    });
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);

    await vi.waitFor(() => expect(getActiveToast()?.key).toBe("photoSaved"));
    await vi.waitFor(() => expect(control()).toHaveFocus());
  });

  test.each([
    [
      "dailyCap",
      { formError: "dailyCap", reopensOnLabel: "Thu 12 Nov" },
      t(photos.dailyCap, { date: "Thu 12 Nov" }),
    ],
    [
      "monthlyCap",
      { formError: "monthlyCap", reopensOnLabel: "Tue 1 Dec" },
      t(photos.monthlyCap, { date: "Tue 1 Dec" }),
    ],
    ["storageFull", { formError: "storageFull" }, photos.storageFull],
  ] as const)(
    "%s: the paused notice, focused, with its line",
    async (_case, state, line) => {
      vi.mocked(uploadItemPhoto).mockResolvedValue(state);
      render(<ItemPhotoForm {...PROPS} />);

      await userEvent.upload(control(), picked);

      const heading = await screen.findByText(photos.pausedHeading);
      expect(screen.getByText(line)).toBeInTheDocument();
      await vi.waitFor(() =>
        expect(heading.closest("[tabindex]")).toHaveFocus(),
      );
      expect(getActiveToast()).toBeNull();
    },
  );

  test.each([
    ["unreadable", photos.unreadable],
    ["stale", errors.stale],
    ["unexpected", errors.actionFailed],
  ] as const)("%s: its notice, focused", async (formError, text) => {
    vi.mocked(uploadItemPhoto).mockResolvedValue({ formError });
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);

    const notice = await screen.findByText(text);
    await vi.waitFor(() => expect(notice.closest("[tabindex]")).toHaveFocus());
  });

  test("a field error sits under the control and focuses it", async () => {
    vi.mocked(uploadItemPhoto).mockResolvedValue({
      fieldErrors: { photo: [photos.photoTooLarge] },
    });
    render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);

    const message = await screen.findByText(photos.photoTooLarge);
    expect(control()).toHaveAttribute("aria-invalid", "true");
    expect(control()).toHaveAttribute("aria-describedby", message.id);
    await vi.waitFor(() => expect(control()).toHaveFocus());
  });

  test("each preview's object URL is revoked when replaced and on unmount", async () => {
    vi.mocked(uploadItemPhoto).mockResolvedValue({ formError: "stale" });
    const { unmount } = render(<ItemPhotoForm {...PROPS} />);

    await userEvent.upload(control(), picked);
    await vi.waitFor(() => expect(uploadItemPhoto).toHaveBeenCalledTimes(1));
    await userEvent.upload(control(), picked);
    await vi.waitFor(() => expect(uploadItemPhoto).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1"),
    );

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
  });
});
