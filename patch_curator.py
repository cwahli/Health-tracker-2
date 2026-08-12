import re

with open('server_food_resolver_curator.ts', 'r') as f:
    content = f.read()

# For normalize_basis
normalize_block = """
  const normalizations = jsonResult.actions.filter((a: any) => a.type === 'normalize_basis');
  for (const norm of normalizations) {
    addDebugLog(`[CuratorAction] normalize_basis for ${norm.fdcId} from ${norm.fromBasis} to ${norm.toBasis} (LLM factor: ${norm.conversionFactor}). Reason: ${norm.reason}`);
    try {
      await supabaseAdmin.from('food_items')
        .update({ basis_type: norm.toBasis }) // server recalculation would happen elsewhere, or we just update the metadata
        .eq('food_id', norm.fdcId);
    } catch (e) {
      console.error(e);
    }
  }
"""

# For quarantine
quarantine_block = """
  const quarantines = jsonResult.actions.filter((a: any) => a.type === 'quarantine');
  for (const q of quarantines) {
     addDebugLog(`[CatalogQuarantine] Quarantined ${q.fdcId}. Reason: ${q.reason}`);
     try {
       await supabaseAdmin.from('food_items')
         .update({ status: 'quarantined' })
         .eq('food_id', q.fdcId);
     } catch (e) {
       console.error(e);
     }
  }
"""

content = re.sub(r'const quarantines = jsonResult\.actions\.filter.*?  }', normalize_block + quarantine_block, content, flags=re.DOTALL)

with open('server_food_resolver_curator.ts', 'w') as f:
    f.write(content)
