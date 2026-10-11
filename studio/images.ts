export function readImageFile(file: File, maxWidth = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that image."));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxWidth / Math.max(1, image.width));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => resolve(url);
      image.src = url;
    };
    reader.readAsDataURL(file);
  });
}
