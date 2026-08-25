import { describe, it, expect } from "vitest";
import {
  isStandaloneCondimentPacket,
  classifyDishAtomic,
  reconcileContainerVolumeBudget,
} from "./server_dish_classify";

describe("server_dish_classify", () => {
  describe("isStandaloneCondimentPacket", () => {
    it("identifies standalone condiments without parent tokens", () => {
      expect(isStandaloneCondimentPacket({ originalName: "Heinz Mayonnaise", keyword: "mayo" })).toBe(true);
      expect(isStandaloneCondimentPacket({ originalName: "Ranch dressing packet", keyword: "ranch" })).toBe(true);
      expect(isStandaloneCondimentPacket({ originalName: "BBQ Sauce", keyword: "barbecue sauce" })).toBe(true);
      expect(isStandaloneCondimentPacket({ originalName: "Tomato Ketchup", keyword: "ketchup" })).toBe(true);
      expect(isStandaloneCondimentPacket({ originalName: "Mustard dip", keyword: "mustard" })).toBe(true);
    });

    it("does NOT cap parent dishes whose names contain sauce or dressing tokens", () => {
      // Yolk class: sandwich with chimichurri sauce
      expect(isStandaloneCondimentPacket({
        originalName: "YOLK Steak Chimi 2.0 Sandwich",
        keyword: "chicken sandwich with chimichurri sauce",
      })).toBe(false);

      // Sushi class: shrimp and pasta salad with dressing
      expect(isStandaloneCondimentPacket({
        originalName: "Shrimp and pasta salad with thousand island dressing",
        keyword: "shrimp pasta salad",
      })).toBe(false);

      // Other composed parent dishes
      expect(isStandaloneCondimentPacket({ originalName: "Chicken Caesar Wrap with dressing", keyword: "caesar wrap" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Spaghetti with meat sauce", keyword: "pasta bolognese" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Noodle bowl with spicy sauce", keyword: "spicy noodles" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Burger with special sauce", keyword: "cheeseburger" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Salmon sushi roll with soy sauce", keyword: "sushi roll" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Chicken Curry with rice", keyword: "curry bowl" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Cheese Panini with pesto sauce", keyword: "panini" })).toBe(false);
    });

    it("returns false for non-condiment items", () => {
      expect(isStandaloneCondimentPacket({ originalName: "Banana", keyword: "banana" })).toBe(false);
      expect(isStandaloneCondimentPacket({ originalName: "Butter Croissant", keyword: "croissant" })).toBe(false);
    });
  });

  describe("classifyDishAtomic", () => {
    it("correctly identifies atomic staples", () => {
      expect(classifyDishAtomic({ originalName: "Banana", keyword: "fresh banana" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Apple", keyword: "raw apple" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Plum", keyword: "plum" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Butter Croissant", keyword: "croissant" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "French Baguette", keyword: "baguette" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Dinner Roll", keyword: "bread roll" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Boiled Egg", keyword: "egg" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Grilled Chicken Breast", keyword: "chicken breast" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Espresso", keyword: "espresso" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Duerr's Strawberry Jam", keyword: "strawberry jam" })).toBe("atomic");
      expect(classifyDishAtomic({ originalName: "Pain au chocolat", keyword: "chocolate pastry" })).toBe("atomic");
    });

    it("correctly identifies composed culinary dishes", () => {
      expect(classifyDishAtomic({ originalName: "YOLK Steak Chimi 2.0 Sandwich", keyword: "steak sandwich" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Chicken breast sandwich", keyword: "sandwich" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Banana smoothie", keyword: "smoothie" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Salmon and avocado sushi roll", keyword: "sushi roll" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Butter Chicken with naan", keyword: "butter chicken" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Grilled Cheese Sandwich", keyword: "grilled cheese" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Shrimp pasta salad with thousand island dressing", keyword: "shrimp pasta salad" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Egg fried rice", keyword: "fried rice" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Yogurt parfait with granola", keyword: "parfait" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Coffee cake", keyword: "cake" })).toBe("composed");
      expect(classifyDishAtomic({ originalName: "Mie Gacoan Spicy Noodles", keyword: "noodles" })).toBe("composed");
    });
  });

  describe("reconcileContainerVolumeBudget", () => {
    it("scales co-located items sharing a constrained container down to container capacity", () => {
      const items = [
        {
          originalName: "Sizzling Steak with Black Pepper Sauce",
          keyword: "beef steak with black pepper sauce",
          estimatedWeightGrams: 250,
          sourceImageIndex: 1,
          nutrients: { protein: 42, carbohydrates: 12, totalFat: 18, calories: 378 }
        },
        {
          originalName: "Mixed Vegetables",
          keyword: "mixed vegetables",
          estimatedWeightGrams: 130,
          sourceImageIndex: 1,
          nutrients: { protein: 4, carbohydrates: 22, totalFat: 4, calories: 140 }
        },
        {
          originalName: "Potato Wedges (Steak Side)",
          keyword: "potato wedges",
          estimatedWeightGrams: 100,
          sourceImageIndex: 1,
          nutrients: { protein: 2.5, carbohydrates: 25, totalFat: 6, calories: 164 }
        }
      ];

      // Total weight = 250 + 130 + 100 = 480g > 320g max capacity for sizzling_skillet
      const reconciled = reconcileContainerVolumeBudget(items);
      const totalReconciled = reconciled.reduce((sum, it) => sum + it.estimatedWeightGrams, 0);

      expect(totalReconciled).toBeLessThanOrEqual(320);
      expect(reconciled[0].estimatedWeightGrams).toBeLessThan(250);
      expect(reconciled[1].estimatedWeightGrams).toBeLessThan(130);
      expect(reconciled[2].estimatedWeightGrams).toBeLessThan(100);
      expect(reconciled[0].nutrients.protein).toBeLessThan(42);
    });

    it("does not scale unconstrained plates or normal weight containers", () => {
      const items = [
        {
          originalName: "Fried Fish Fillet",
          keyword: "fried fish",
          estimatedWeightGrams: 220,
          sourceImageIndex: 0
        },
        {
          originalName: "Potato Wedges",
          keyword: "potato wedges",
          estimatedWeightGrams: 120,
          sourceImageIndex: 0
        }
      ];

      const reconciled = reconcileContainerVolumeBudget(items);
      expect(reconciled[0].estimatedWeightGrams).toBe(220);
      expect(reconciled[1].estimatedWeightGrams).toBe(120);
    });
  });
});

