import { useMemo, useState } from "react";
import {
  calculateBaseCubicYards,
  calculateOrderQuantity,
  calculateRecommendedCubicYards,
  findMaterialConversion,
  orderedMaterialConversionGroups,
  productPageUrl,
  type MaterialConversion,
} from "../lib/material-calculator";

type CalculatorProduct = {
  title: string;
  handle?: string | null;
  sku?: string | null;
};

type MaterialCalculatorProps = {
  product: CalculatorProduct;
  onApplyQuantity: (quantity: number) => void;
  onClose: () => void;
};

function numberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function materialOrderAmountLabel(material: MaterialConversion | null, recommendedYards: number) {
  const quantity = calculateOrderQuantity(recommendedYards, material);
  if (!material || material.soldBy === "yard") return `${quantity} cubic yard${quantity === 1 ? "" : "s"}`;
  return `${quantity} ton${quantity === 1 ? "" : "s"}`;
}

export function MaterialCalculator({ product, onApplyQuantity, onClose }: MaterialCalculatorProps) {
  const [shape, setShape] = useState<"rectangle" | "circle" | "area">("rectangle");
  const [lengthFeet, setLengthFeet] = useState("");
  const [widthFeet, setWidthFeet] = useState("");
  const [diameterFeet, setDiameterFeet] = useState("");
  const [areaValue, setAreaValue] = useState("");
  const [areaUnit, setAreaUnit] = useState<"square-feet" | "square-inches">("square-feet");
  const [depthInches, setDepthInches] = useState("");
  const [manualYards, setManualYards] = useState("");
  const [extraPercent, setExtraPercent] = useState("10");

  const selectedMaterial = useMemo(() => findMaterialConversion(product), [product]);
  const groups = useMemo(() => orderedMaterialConversionGroups(product), [product]);
  const baseYards = calculateBaseCubicYards({
    shape,
    lengthFeet: numberInput(lengthFeet),
    widthFeet: numberInput(widthFeet),
    diameterFeet: numberInput(diameterFeet),
    areaValue: numberInput(areaValue),
    areaUnit,
    depthInches: numberInput(depthInches),
    manualYards: numberInput(manualYards),
  });
  const recommendedYards = calculateRecommendedCubicYards(baseYards, numberInput(extraPercent));
  const recommendedQuantity = calculateOrderQuantity(recommendedYards, selectedMaterial);
  const selectedProductUrl = productPageUrl(product.handle || selectedMaterial?.handle || "");

  return (
    <div className="materialCalculatorOverlay" role="dialog" aria-modal="true" aria-label="Green Hills Material Calculator">
      <div className="materialCalculatorPanel">
        <div className="materialCalculatorHeader">
          <div>
            <p className="materialCalculatorEyebrow">Green Hills</p>
            <h2>Material Calculator</h2>
            <p>
              Planning for{" "}
              {selectedProductUrl ? (
                <a href={selectedProductUrl} target="_blank" rel="noreferrer">
                  {product.title}
                </a>
              ) : (
                <strong>{product.title}</strong>
              )}
            </p>
          </div>
          <button type="button" className="materialCalculatorClose" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="materialCalculatorHero">
          <div>
            <span>Originating category</span>
            <strong>{selectedMaterial?.category || "Select from calculator list"}</strong>
          </div>
          <div>
            <span>Estimated order amount</span>
            <strong>{materialOrderAmountLabel(selectedMaterial, recommendedYards)}</strong>
          </div>
        </div>

        <div className="materialCalculatorGrid">
          <section className="materialCalculatorCard">
            <h3>Project dimensions</h3>
            <div className="materialCalculatorShapeRow">
              <button type="button" className={shape === "rectangle" ? "active" : ""} onClick={() => setShape("rectangle")}>
                Rectangle
              </button>
              <button type="button" className={shape === "circle" ? "active" : ""} onClick={() => setShape("circle")}>
                Circle
              </button>
              <button type="button" className={shape === "area" ? "active" : ""} onClick={() => setShape("area")}>
                Known area
              </button>
            </div>

            {shape === "rectangle" ? (
              <div className="materialCalculatorInputs">
                <label>
                  Length feet
                  <input inputMode="decimal" type="number" min="0" value={lengthFeet} onChange={(event) => setLengthFeet(event.currentTarget.value)} />
                </label>
                <label>
                  Width feet
                  <input inputMode="decimal" type="number" min="0" value={widthFeet} onChange={(event) => setWidthFeet(event.currentTarget.value)} />
                </label>
                <label>
                  Depth inches
                  <input inputMode="decimal" type="number" min="0" value={depthInches} onChange={(event) => setDepthInches(event.currentTarget.value)} />
                </label>
              </div>
            ) : shape === "circle" ? (
              <div className="materialCalculatorInputs">
                <label>
                  Diameter feet
                  <input inputMode="decimal" type="number" min="0" value={diameterFeet} onChange={(event) => setDiameterFeet(event.currentTarget.value)} />
                </label>
                <label>
                  Depth inches
                  <input inputMode="decimal" type="number" min="0" value={depthInches} onChange={(event) => setDepthInches(event.currentTarget.value)} />
                </label>
              </div>
            ) : (
              <div className="materialCalculatorInputs materialCalculatorAreaInputs">
                <label>
                  Area
                  <input inputMode="decimal" type="number" min="0" value={areaValue} onChange={(event) => setAreaValue(event.currentTarget.value)} />
                </label>
                <label>
                  Area unit
                  <select value={areaUnit} onChange={(event) => setAreaUnit(event.currentTarget.value as "square-feet" | "square-inches")}>
                    <option value="square-feet">Square feet</option>
                    <option value="square-inches">Square inches</option>
                  </select>
                </label>
                <label>
                  Depth inches
                  <input inputMode="decimal" type="number" min="0" value={depthInches} onChange={(event) => setDepthInches(event.currentTarget.value)} />
                </label>
              </div>
            )}

            <label className="materialCalculatorManual">
              Already know cubic yards?
              <input inputMode="decimal" type="number" min="0" value={manualYards} onChange={(event) => setManualYards(event.currentTarget.value)} placeholder="Optional override" />
            </label>

            <label className="materialCalculatorRange">
              Settling / waste: <strong>{extraPercent}%</strong>
              <input type="range" min="0" max="20" step="5" value={extraPercent} onChange={(event) => setExtraPercent(event.currentTarget.value)} />
            </label>
          </section>

          <section className="materialCalculatorCard materialCalculatorResult">
            <h3>Quote quantity</h3>
            <dl>
              <div>
                <dt>Base volume</dt>
                <dd>{baseYards.toFixed(2)} cubic yards</dd>
              </div>
              <div>
                <dt>With settling / waste</dt>
                <dd>{recommendedYards.toFixed(2)} cubic yards</dd>
              </div>
              <div>
                <dt>Recommended order</dt>
                <dd>{materialOrderAmountLabel(selectedMaterial, recommendedYards)}</dd>
              </div>
            </dl>
            <button type="button" className="materialCalculatorApply" disabled={recommendedQuantity <= 0} onClick={() => onApplyQuantity(recommendedQuantity)}>
              Back to {product.title} with qty {recommendedQuantity || 0}
            </button>
          </section>
        </div>

        <section className="materialCalculatorConversions">
          <div>
            <p className="materialCalculatorEyebrow">Conversion guide</p>
            <h3>Materials</h3>
          </div>
          {groups.map((group) => (
            <div className="materialCalculatorCategory" key={group.category}>
              <h4>{group.category}</h4>
              <div className="materialCalculatorMaterialList">
                {group.materials.map((material) => {
                  const isSelected = selectedMaterial?.name === material.name;
                  const url = productPageUrl(material.handle);
                  return (
                    <div className={isSelected ? "materialCalculatorMaterial active" : "materialCalculatorMaterial"} key={`${group.category}-${material.name}`}>
                      <span>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {material.name}
                          </a>
                        ) : (
                          material.name
                        )}
                      </span>
                      <strong>{material.soldBy === "yard" ? "Cubic yards" : `${material.tonsPerYard} tons / yd`}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
