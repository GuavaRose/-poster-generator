import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Download,
  Upload,
  Layout,
  Calendar,
  MapPin,
  Type,
  Image as ImageIcon,
  Palette,
} from "lucide-react";
import * as htmlToImage from "html-to-image";

const THEMES = {
  theme1: {
    name: "套組一 (粉色工作坊)",
    images: {
      background: "/images/theme1-bg.jpg.png",
      logo: "/images/logo1.png.png",
      illustration: "/images/theme1-ill.png.png",
    },
  },
  theme2: {
    name: "套組二 (綠色原子能)",
    images: {
      background: "/images/theme2-bg.jpg.png",
      logo: "/images/logo2.png.png",
      illustration: "/images/theme2-ill.png.png",
    },
  },
};

/* ------------------------------------------------------------------
 * 關鍵工具 1：自動裁掉 PNG 四周的透明空白，並回傳長寬比
 * 這是 logo 一直「縮水」的真正原因 —— 圖檔本身留白太多，
 * CSS 設定的是「圖檔的框」，不是「圖案本身」。
 * 順便把圖轉成 dataURL，html-to-image 匯出時也不會再漏圖。
 * ------------------------------------------------------------------ */
type Trimmed = { src: string; ratio: number };

const trimImage = (src: string): Promise<Trimmed> =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const fallback = {
        src,
        ratio: img.naturalWidth / img.naturalHeight || 1,
      };
      try {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(fallback);
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, W, H);

        let top = H,
          left = W,
          right = -1,
          bottom = -1;
        const ALPHA = 12;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (data[(y * W + x) * 4 + 3] > ALPHA) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (right < 0) return resolve(fallback); // 全透明，放棄裁切

        const w = right - left + 1;
        const h = bottom - top + 1;
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        out.getContext("2d")!.drawImage(c, left, top, w, h, 0, 0, w, h);
        resolve({ src: out.toDataURL("image/png"), ratio: w / h });
      } catch {
        // 跨網域圖片會污染 canvas，直接用原圖
        resolve(fallback);
      }
    };
    img.onerror = () => resolve({ src, ratio: 1 });
    img.src = src;
  });

/* ------------------------------------------------------------------
 * 關鍵工具 2：偵測這台裝置有沒有標楷體
 * 標楷體是授權字型，不能自行放上網站散布，只能確認使用者本機有沒有。
 * 原理：同一串字分別用 monospace 和候選字型量寬度，有變就代表字型存在。
 * ------------------------------------------------------------------ */
const KAI_FAMILIES = [
  "DFKai-SB",
  "BiauKai",
  "標楷體",
  "Kaiti TC",
  "TW-Kai",
  "全字庫正楷體",
];

const detectKai = () => {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const probe = "國字標準楷書永";
  ctx.font = "72px monospace";
  const base = ctx.measureText(probe).width;
  return KAI_FAMILIES.some((f) => {
    ctx.font = `72px "${f}", monospace`;
    return ctx.measureText(probe).width !== base;
  });
};

const App = () => {
  const [ratio, setRatio] = useState("1:1");
  const [activeTheme, setActiveTheme] = useState("none");

  const [images, setImages] = useState({
    background: null as string | null,
    logo: null as string | null,
    illustration: null as string | null,
  });

  const [texts, setTexts] = useState({
    category: "學術講演會",
    topic: "「打造你的研究助手：\nAI Agent 如何協助檢索與驗證」工作坊",
    speaker: "Calvin Yeh 先生",
    speakerTitle: "德國MPIWG數位人文學者",
    extraRole: "評論人",
    extraName: "劉維開 教授",
    extraTitle: "政治大學歷史學系退休教授",
    showExtra: false,
    date: "2026/08/19 (10:00~15:00)",
    location: "近史所檔案館第二會議室",
  });

  const [topicSize, setTopicSize] = useState(72);

  /* ---- 版面微調（全部以 1080px 畫布為單位）---- */
  const [panelOpacity, setPanelOpacity] = useState(0.5);
  const [badgeX, setBadgeX] = useState(0);
  const [badgeY, setBadgeY] = useState(0);

  const [infoGap, setInfoGap] = useState(16);

  const [logo, setLogo] = useState({ width: 300, x: 75, y: 45 });
  const [ill, setIll] = useState({
    width: 380,
    right: 0,
    bottom: 0,
    opacity: 1,
  });
  const [illOnTop, setIllOnTop] = useState(false);

  const [hasKai, setHasKai] = useState(true);
  useEffect(() => {
    setHasKai(detectKai());
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);

  const posterH = ratio === "1:1" ? 1080 : 1350;

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setScale(entries[0].contentRect.width / 1080);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  /* 載入圖片一律先過 trimImage */
  const setImageSrc = useCallback(
    async (key: "background" | "logo" | "illustration", src: string) => {
      if (key === "background") {
        setImages((p) => ({ ...p, background: src }));
        return;
      }
      const { src: trimmed } = await trimImage(src);
      setImages((p) => ({ ...p, [key]: trimmed }));
    },
    []
  );

  const handleThemeChange = (themeKey: string) => {
    setActiveTheme(themeKey);
    if (themeKey !== "none" && themeKey !== "custom") {
      const t = THEMES[themeKey as keyof typeof THEMES];
      setImageSrc("background", t.images.background);
      setImageSrc("logo", t.images.logo);
      setImageSrc("illustration", t.images.illustration);
    }
  };

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    key: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageSrc(
        key as "background" | "logo" | "illustration",
        ev.target?.result as string
      );
      setActiveTheme("custom");
    };
    reader.readAsDataURL(file);
  };

  const handleTextChange = (key: string, value: string | boolean) => {
    setTexts((prev) => ({ ...prev, [key]: value }));
  };

  /* ---- 匯出：等字型與圖片就緒，並且渲染兩次（第一次是暖機）---- */
  const downloadImage = async () => {
    const node = posterRef.current;
    if (!node) return;
    setIsGenerating(true);
    try {
      if ((document as any).fonts?.ready) await (document as any).fonts.ready;
      await Promise.all(
        Array.from(node.querySelectorAll("img")).map(
          (im) =>
            (im as HTMLImageElement).decode?.().catch(() => undefined) ??
            Promise.resolve()
        )
      );

      const opts = {
        quality: 1,
        pixelRatio: 2,
        width: 1080,
        height: posterH,
        backgroundColor: "#ffffff",
        style: { transform: "none", transformOrigin: "top left", margin: "0" },
      };

      await htmlToImage.toJpeg(node, opts); // 暖機，解決首次匯出漏圖
      const dataUrl = await htmlToImage.toJpeg(node, opts);

      const link = document.createElement("a");
      link.download = `演講公告_${texts.topic
        .replace(/\n/g, "")
        .substring(0, 10)}.jpg`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error("生成圖片失敗:", error);
      alert("圖片生成失敗，請稍後再試。");
    } finally {
      setIsGenerating(false);
    }
  };

  const categoryOptions = ["學術討論會", "學術講演會"];
  const locationOptions = [
    "近史所檔案館第一會議室",
    "近史所檔案館第二會議室",
    "近史所檔案館第三會議室",
    "近史所研究大樓一樓會議室",
  ];

  /* Times New Roman 排在最前面，讓英文與數字維持襯線體；
     中文會依序往後找標楷體，最後才落到網頁字型霞鶩文楷 TC。 */
  const serifFont = {
    fontFamily:
      '"Times New Roman", "DFKai-SB", "BiauKai", "標楷體", "Kaiti TC", "TW-Kai", "全字庫正楷體", "LXGW WenKai TC", serif',
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans text-gray-800">
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-700 flex items-center gap-2">
          <Layout className="w-8 h-8 text-blue-600" />
          演講公告生成工具
        </h1>
        <button
          onClick={downloadImage}
          disabled={isGenerating}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-white font-medium transition-all shadow-md ${
            isGenerating
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700 active:scale-95"
          }`}
        >
          <Download size={20} />
          {isGenerating ? "生成中..." : "下載高清圖片"}
        </button>
      </header>

      {!hasKai && (
        <div className="max-w-7xl mx-auto mb-6 px-4 py-3 rounded-lg bg-amber-50 border border-amber-300 text-sm text-amber-900">
          這台裝置沒有標楷體，公告會改用替代楷體，字形與所內慣用版本略有出入。建議改用
          Windows 或 Mac 產出正式檔案。
        </div>
      )}

      <main className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        <div className="md:col-span-5 space-y-6">
          <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-700">
              <Palette size={18} /> 主題與版面
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  快速套組 (自動載入圖片)
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                  value={activeTheme}
                  onChange={(e) => handleThemeChange(e.target.value)}
                >
                  <option value="none">-- 選擇套組 --</option>
                  {Object.entries(THEMES).map(([key, theme]) => (
                    <option key={key} value={key}>
                      {theme.name}
                    </option>
                  ))}
                  <option value="custom" disabled>
                    自訂上傳
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  圖片比例
                </label>
                <div className="flex gap-4">
                  {["4:5", "1:1"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setRatio(r)}
                      className={`flex-1 py-2 px-4 rounded-md border text-sm font-medium transition-colors ${
                        ratio === r
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 hover:border-gray-300 text-gray-600"
                      }`}
                    >
                      {r} {r === "4:5" ? "(海報)" : "(方形)"}
                    </button>
                  ))}
                </div>
              </div>
              <Slider
                label="白色區塊透明度"
                value={panelOpacity}
                min={0}
                max={1}
                step={0.05}
                onChange={setPanelOpacity}
                format={(v) => `${Math.round(v * 100)}%`}
              />
              <Slider
                label="時間地點間距"
                value={infoGap}
                min={0}
                max={60}
                step={1}
                onChange={setInfoGap}
                format={(v) => `${v}px`}
              />
            </div>
          </section>

          <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-700">
              <ImageIcon size={18} /> 手動替換素材
            </h2>
            <div className="grid grid-cols-1 gap-4">
              <UploadBtn
                label="背景圖片"
                id="background-upload"
                onChange={handleImageUpload}
                hasFile={!!images.background}
              />
              <UploadBtn
                label="Logo 圖片"
                id="logo-upload"
                onChange={handleImageUpload}
                hasFile={!!images.logo}
              />
              <UploadBtn
                label="右下插圖"
                id="illustration-upload"
                onChange={handleImageUpload}
                hasFile={!!images.illustration}
              />
            </div>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              上傳後會自動裁掉 PNG
              四周的透明留白，所以下面的尺寸數字就等於圖案本身的實際大小。
            </p>
          </section>

          <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 text-gray-700">
              Logo 與插圖微調
            </h2>
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-600">左上 Logo</p>
                <Slider
                  label="寬度"
                  value={logo.width}
                  min={80}
                  max={700}
                  step={2}
                  onChange={(v) => setLogo((p) => ({ ...p, width: v }))}
                  format={(v) => `${v}px`}
                />
                <Slider
                  label="左邊距"
                  value={logo.x}
                  min={0}
                  max={400}
                  step={1}
                  onChange={(v) => setLogo((p) => ({ ...p, x: v }))}
                  format={(v) => `${v}px`}
                />
                <Slider
                  label="上邊距"
                  value={logo.y}
                  min={0}
                  max={300}
                  step={1}
                  onChange={(v) => setLogo((p) => ({ ...p, y: v }))}
                  format={(v) => `${v}px`}
                />
              </div>
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium text-gray-600">右下插圖</p>
                <Slider
                  label="寬度"
                  value={ill.width}
                  min={100}
                  max={900}
                  step={2}
                  onChange={(v) => setIll((p) => ({ ...p, width: v }))}
                  format={(v) => `${v}px`}
                />
                <Slider
                  label="右邊距"
                  value={ill.right}
                  min={-100}
                  max={400}
                  step={1}
                  onChange={(v) => setIll((p) => ({ ...p, right: v }))}
                  format={(v) => `${v}px`}
                />
                <Slider
                  label="下邊距"
                  value={ill.bottom}
                  min={-100}
                  max={400}
                  step={1}
                  onChange={(v) => setIll((p) => ({ ...p, bottom: v }))}
                  format={(v) => `${v}px`}
                />
                <Slider
                  label="透明度"
                  value={ill.opacity}
                  min={0.2}
                  max={1}
                  step={0.05}
                  onChange={(v) => setIll((p) => ({ ...p, opacity: v }))}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <label className="flex items-center text-xs text-gray-500 cursor-pointer select-none pt-1">
                  <input
                    type="checkbox"
                    className="mr-2 rounded"
                    checked={illOnTop}
                    onChange={(e) => setIllOnTop(e.target.checked)}
                  />
                  插圖壓在白色區塊上方
                </label>
              </div>
            </div>
          </section>

          <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-700">
              <Type size={18} /> 內容編輯
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  活動類別
                </label>
                <div className="flex flex-col gap-2">
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    value={
                      categoryOptions.includes(texts.category)
                        ? texts.category
                        : "custom"
                    }
                    onChange={(e) =>
                      handleTextChange(
                        "category",
                        e.target.value === "custom" ? "" : e.target.value
                      )
                    }
                  >
                    {categoryOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                    <option value="custom">其他（自行輸入）</option>
                  </select>
                  {!categoryOptions.includes(texts.category) && (
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      placeholder="請輸入活動類別"
                      value={texts.category}
                      onChange={(e) =>
                        handleTextChange("category", e.target.value)
                      }
                    />
                  )}
                </div>
                <div className="mt-2 bg-gray-50 p-3 rounded border border-gray-100 space-y-2">
                  <Slider
                    label="標籤左右"
                    value={badgeX}
                    min={-400}
                    max={400}
                    step={1}
                    onChange={setBadgeX}
                    format={(v) => `${v}px`}
                  />
                  <Slider
                    label="標籤上下"
                    value={badgeY}
                    min={-120}
                    max={200}
                    step={1}
                    onChange={setBadgeY}
                    format={(v) => `${v}px`}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-sm font-medium text-gray-600">
                    講題
                  </label>
                  <span className="text-xs text-gray-400">
                    字級: {topicSize}px
                  </span>
                </div>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 resize-none"
                  value={texts.topic}
                  onChange={(e) => handleTextChange("topic", e.target.value)}
                />
                <input
                  type="range"
                  min="40"
                  max="120"
                  value={topicSize}
                  onChange={(e) => setTopicSize(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <InputGroup
                  label="主講人姓名"
                  value={texts.speaker}
                  onChange={(v) => handleTextChange("speaker", v)}
                />
                <InputGroup
                  label="主講人頭銜"
                  value={texts.speakerTitle}
                  onChange={(v) => handleTextChange("speakerTitle", v)}
                />
              </div>

              <div className="border-t pt-4 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    額外人員 (選填)
                  </label>
                  <label className="flex items-center text-sm text-gray-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="mr-2 rounded"
                      checked={texts.showExtra}
                      onChange={(e) =>
                        handleTextChange("showExtra", e.target.checked)
                      }
                    />{" "}
                    顯示
                  </label>
                </div>
                {texts.showExtra && (
                  <div className="space-y-3 bg-gray-50 p-3 rounded-lg">
                    <div className="flex gap-2">
                      {["評論人", "主持人"].map((role) => (
                        <button
                          key={role}
                          onClick={() => handleTextChange("extraRole", role)}
                          className={`px-3 py-1 text-xs rounded-full border ${
                            texts.extraRole === role
                              ? "bg-gray-700 text-white"
                              : "bg-white text-gray-600"
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <InputGroup
                        label="姓名"
                        value={texts.extraName}
                        onChange={(v) => handleTextChange("extraName", v)}
                      />
                      <InputGroup
                        label="頭銜"
                        value={texts.extraTitle}
                        onChange={(v) => handleTextChange("extraTitle", v)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t pt-4 mt-2 space-y-3">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-gray-400" />
                  <input
                    type="text"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="時間"
                    value={texts.date}
                    onChange={(e) => handleTextChange("date", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} className="text-gray-400" />
                    <select
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      value={
                        locationOptions.includes(texts.location)
                          ? texts.location
                          : "custom"
                      }
                      onChange={(e) =>
                        handleTextChange(
                          "location",
                          e.target.value === "custom" ? "" : e.target.value
                        )
                      }
                    >
                      {locationOptions.map((loc) => (
                        <option key={loc} value={loc}>
                          {loc}
                        </option>
                      ))}
                      <option value="custom">其他（自行輸入地點）</option>
                    </select>
                  </div>
                  {!locationOptions.includes(texts.location) && (
                    <div className="flex items-center gap-2">
                      <div className="w-6" />
                      <input
                        type="text"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        placeholder="請輸入地點"
                        value={texts.location}
                        onChange={(e) =>
                          handleTextChange("location", e.target.value)
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="md:col-span-7 flex flex-col items-center">
          <div className="sticky top-8 w-full max-w-[700px]">
            <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-3 text-center">
                即時預覽 (所見即所得，輸出尺寸固定 1080px)
              </h3>

              <div
                ref={containerRef}
                className={`relative w-full overflow-hidden bg-slate-100 ${
                  ratio === "4:5" ? "aspect-[4/5]" : "aspect-square"
                }`}
              >
                <div
                  id="scale-wrapper"
                  style={{
                    width: "1080px",
                    height: `${posterH}px`,
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    position: "absolute",
                    top: 0,
                    left: 0,
                  }}
                >
                  <div
                    ref={posterRef}
                    style={{
                      width: "1080px",
                      height: `${posterH}px`,
                      position: "relative",
                      backgroundColor: "#fff",
                      overflow: "hidden",
                    }}
                  >
                    {/* 背景 */}
                    {images.background ? (
                      <div
                        className="absolute inset-0 z-0"
                        style={{
                          backgroundImage: `url(${images.background})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      />
                    ) : (
                      <div
                        className="absolute inset-0 z-0"
                        style={{
                          background:
                            "linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)",
                        }}
                      />
                    )}

                    {/* 半透明白底 */}
                    <div
                      className="absolute top-[120px] bottom-[100px] left-[80px] right-[80px] z-10"
                      style={{
                        backgroundColor: `rgba(255,255,255,${panelOpacity})`,
                      }}
                    />

                    {/* 右下插圖 */}
                    {images.illustration && (
                      <img
                        src={images.illustration}
                        alt="Illustration"
                        className="absolute block"
                        style={{
                          width: `${ill.width}px`,
                          height: "auto",
                          right: `${ill.right}px`,
                          bottom: `${ill.bottom}px`,
                          opacity: ill.opacity,
                          zIndex: illOnTop ? 20 : 5,
                        }}
                      />
                    )}

                    {/* 文字層 */}
                    <div className="absolute top-[120px] bottom-[100px] left-[80px] right-[80px] z-30 flex flex-col bg-transparent px-[80px] py-[60px]">
                      <div className="flex-1 flex flex-col items-center justify-center mt-[40px]">
                        <h1
                          className="font-bold text-gray-900 leading-[1.3] text-center whitespace-pre-wrap w-full mb-[60px]"
                          style={{
                            ...serifFont,
                            fontSize: `${topicSize}px`,
                            wordBreak: "break-word",
                          }}
                        >
                          {texts.topic}
                        </h1>
                        <div className="w-full text-center">
                          <div
                            className="font-bold text-gray-900 flex items-baseline justify-center gap-[16px] mb-[12px]"
                            style={{ ...serifFont, fontSize: "56px" }}
                          >
                            <span
                              className="font-bold text-gray-700"
                              style={{ fontSize: "40px" }}
                            >
                              主講人：
                            </span>
                            {texts.speaker}
                          </div>
                          {texts.speakerTitle && (
                            <div
                              className="text-gray-600"
                              style={{ ...serifFont, fontSize: "36px" }}
                            >
                              ({texts.speakerTitle})
                            </div>
                          )}
                        </div>
                        {texts.showExtra && (
                          <div className="w-full text-center mt-[40px]">
                            <div
                              className="font-bold text-gray-800 flex items-baseline justify-center gap-[16px] mb-[8px]"
                              style={{ ...serifFont, fontSize: "48px" }}
                            >
                              <span
                                className="font-bold text-gray-600"
                                style={{ fontSize: "36px" }}
                              >
                                {texts.extraRole}：
                              </span>
                              {texts.extraName}
                            </div>
                            {texts.extraTitle && (
                              <div
                                className="text-gray-500"
                                style={{ ...serifFont, fontSize: "32px" }}
                              >
                                ({texts.extraTitle})
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div
                        className="w-full flex flex-col mt-auto"
                        style={{ gap: `${infoGap}px` }}
                      >
                        <div className="flex flex-col">
                          <div
                            className="text-[28px] font-bold text-gray-500 tracking-wider mb-[8px]"
                            style={serifFont}
                          >
                            時間
                          </div>
                          <div
                            className="text-[44px] font-bold text-gray-900 tracking-wide"
                            style={serifFont}
                          >
                            {texts.date}
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <div
                            className="text-[28px] font-bold text-gray-500 tracking-wider mb-[8px]"
                            style={serifFont}
                          >
                            地點
                          </div>
                          <div
                            className="text-[44px] font-bold text-gray-900 tracking-wide"
                            style={serifFont}
                          >
                            {texts.location}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Logo */}
                    {images.logo && (
                      <img
                        src={images.logo}
                        alt="Logo"
                        className="absolute z-40 block"
                        style={{
                          width: `${logo.width}px`,
                          height: "auto",
                          left: `${logo.x}px`,
                          top: `${logo.y}px`,
                        }}
                      />
                    )}

                    {/* 活動類別標籤 */}
                    <div
                      className="absolute top-[120px] left-0 w-full flex justify-center z-50"
                      style={{ pointerEvents: "none" }}
                    >
                      <div
                        className="bg-[#8B2323] text-white px-[48px] py-[16px] rounded-[4px] whitespace-nowrap"
                        style={{
                          ...serifFont,
                          transform: `translate(${badgeX}px, ${badgeY - 35}px)`,
                        }}
                      >
                        <span className="text-[36px] font-bold tracking-[0.2em]">
                          {texts.category}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

const Slider = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-gray-500 w-20 shrink-0">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
    />
    <span className="text-xs text-gray-400 w-14 text-right tabular-nums">
      {format ? format(value) : value}
    </span>
  </div>
);

const UploadBtn = ({
  label,
  id,
  onChange,
  hasFile,
}: {
  label: string;
  id: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>, key: string) => void;
  hasFile: boolean;
}) => (
  <div className="flex items-center justify-between border border-dashed border-gray-300 rounded-lg p-3 hover:bg-gray-50 transition-colors">
    <div className="flex items-center gap-3">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center ${
          hasFile ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
        }`}
      >
        {hasFile ? <ImageIcon size={16} /> : <Upload size={16} />}
      </div>
      <span className="text-sm font-medium text-gray-600">{label}</span>
    </div>
    <label
      htmlFor={id}
      className="cursor-pointer bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded text-xs font-medium hover:text-blue-600 hover:border-blue-400 transition-colors"
    >
      選擇檔案
    </label>
    <input
      type="file"
      id={id}
      accept="image/*"
      onChange={(e) => onChange(e, id.split("-")[0])}
      className="hidden"
    />
  </div>
);

const InputGroup = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-600 mb-1">
      {label}
    </label>
    <input
      type="text"
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default App;
