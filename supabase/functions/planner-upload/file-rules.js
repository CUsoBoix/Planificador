(function (root) {
  "use strict";
  const types = {
    pdf: "application/pdf",
    zip: "application/zip",
    xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    webp: "image/webp",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xls: "application/vnd.ms-excel",
    doc: "application/msword",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  function validate(
    name,
    bytes,
    max = 50 * 1024 * 1024,
    allowed = Object.keys(types),
  ) {
    const extension = name.split(".").pop().toLowerCase(),
      mime = types[extension];
    if (!mime || !allowed.includes(extension))
      throw Error("Tipo de archivo no permitido.");
    if (!bytes.length || bytes.length > max)
      throw Error("Archivo vacío o superior al límite permitido.");
    const starts = (values) => values.every((n, i) => bytes[i] === n);
    if (extension === "pdf" && !starts([37, 80, 68, 70, 45]))
      throw Error("PDF no válido.");
    if (
      ["xls", "doc", "ppt"].includes(extension) &&
      !starts([208, 207, 17, 224, 161, 177, 26, 225])
    )
      throw Error("Documento Office no válido.");
    if (
      extension === "webp" &&
      !(
        starts([82, 73, 70, 70]) &&
        String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
      )
    )
      throw Error("WebP no válido.");
    if (extension === "png" && !starts([137, 80, 78, 71, 13, 10, 26, 10]))
      throw Error("PNG no válido.");
    if (["jpg", "jpeg"].includes(extension) && !starts([255, 216, 255]))
      throw Error("JPEG no válido.");
    if (["txt", "csv"].includes(extension)) {
      if (bytes.includes(0)) throw Error("El fichero no es texto.");
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    if (["xlsx", "docx", "pptx", "xlsb", "zip"].includes(extension)) {
      if (!starts([80, 75, 3, 4])) throw Error("Documento Office no válido.");
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      let end = -1;
      for (
        let p = bytes.length - 22;
        p >= Math.max(0, bytes.length - 65557);
        p--
      )
        if (view.getUint32(p, true) === 0x06054b50) {
          end = p;
          break;
        }
      if (end < 0) throw Error("Archivo ZIP incompleto.");
      const count = view.getUint16(end + 10, true);
      let offset = view.getUint32(end + 16, true),
        size = 0,
        names = [];
      if (count > 5000) throw Error("Documento demasiado complejo.");
      for (let i = 0; i < count; i++) {
        if (
          offset + 46 > bytes.length ||
          view.getUint32(offset, true) !== 0x02014b50
        )
          throw Error("Estructura ZIP no válida.");
        if (view.getUint16(offset + 8, true) & 1)
          throw Error("No se permiten documentos cifrados.");
        size += view.getUint32(offset + 24, true);
        if (size > 200 * 1024 * 1024)
          throw Error("Documento descomprimido demasiado grande.");
        const length = view.getUint16(offset + 28, true),
          extra = view.getUint16(offset + 30, true),
          comment = view.getUint16(offset + 32, true);
        const path = new TextDecoder().decode(
          bytes.slice(offset + 46, offset + 46 + length),
        );
        if (
          path.includes("..") ||
          path.startsWith("/") ||
          path.includes("\\") ||
          /^[a-z]:/i.test(path) ||
          /vbaProject|\.(exe|js|vbs|ps1|bat|cmd|dll|msi|scr|com|hta)$/i.test(
            path,
          )
        )
          throw Error("Contenido no permitido dentro del documento.");
        if (
          extension === "zip" &&
          !path.endsWith("/") &&
          ![
            "pdf",
            "xlsx",
            "xlsb",
            "docx",
            "pptx",
            "xls",
            "doc",
            "ppt",
            "txt",
            "csv",
            "png",
            "jpg",
            "jpeg",
            "webp",
          ].includes(path.split(".").pop().toLowerCase())
        )
          throw Error(
            "El ZIP contiene un formato no permitido o un archivo comprimido anidado.",
          );
        names.push(path);
        offset += 46 + length + extra + comment;
      }
      const expected = {
        xlsx: "xl/workbook.xml",
        xlsb: "xl/workbook.bin",
        docx: "word/document.xml",
        pptx: "ppt/presentation.xml",
      }[extension];
      if (
        extension !== "zip" &&
        (!names.includes("[Content_Types].xml") || !names.includes(expected))
      )
        throw Error("El contenido Office no coincide con la extensión.");
    }
    return { extension, mime };
  }
  root.WorkFiles = { types, validate };
  if (typeof module !== "undefined") module.exports = root.WorkFiles;
})(globalThis);
