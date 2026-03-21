# FIRE Cash Flow Projection — Data & Requirements

## Build a static web app (HTML/CSS/JS) showing 10-year expense coverage projection

### Deploy to: GitHub repo `clio-ai-dev/fire-cashflow` → GitHub Pages

### Data Model

**Monthly expenses: $8,269/mo** (except April 2026: $6,048 + ~$2,000 COBRA = ~$8,048)

**Income: .NET Academy Owner's Comp (pessimistic $6K/mo gross × 65% = $3,900/mo)**
- Realistic scenario too: $12K/mo gross × 65% = $7,800/mo

**Gap at pessimistic: $4,369/mo**
**Gap at realistic: $469/mo**

### Withdrawal Order (tax-optimized):
1. **Academy Owner's Comp**: $3,900/mo (pessimistic) — always first, every month
2. **Beyondsoft final check**: ~$4,000 one-time in April 2026
3. **HSA reimbursements**: up to $50K available, $0 tax. Draw $4,369/mo until depleted
4. **Roth IRA contributions (existing basis)**: ~$34,500, $0 tax. After HSA depleted
5. **Roth IRA rollover basis (after 401K rollover)**: ~$343,000, $0 tax. After existing Roth basis depleted
6. **Family account FZROX**: ~$20,900, ~$138 tax. After Roth depleted
7. **Emergency fund**: $60,000, $0 tax. Last resort

### Growth assumptions:
- Invested accounts (Roth IRA, HSA, Family FZROX): 7% annual real return
- Emergency fund: 4% (cash/money market)
- Academy revenue: flat at pessimistic; also show realistic scenario

### What to show:
1. **Table**: Month-by-month for first 2 years, then quarterly, showing:
   - Month/Quarter
   - Expenses
   - Academy Income
   - Gap
   - Source used to fill gap
   - Amount from each source
   - Remaining balance of each source

2. **Stacked area/bar chart**: 
   - X axis: months (120 months = 10 years)
   - Y axis: dollars
   - Stacked colors showing how much comes from each source per month
   - Color coding: Green=Academy, Blue=HSA, Purple=Roth Contributions, Orange=Roth Rollover, Yellow=Family FZROX, Red=Emergency Fund
   - Line overlay showing total expenses

3. **Second chart**: Remaining balances over time
   - Each account balance as a line, showing depletion curves

4. **Toggle**: Switch between Pessimistic ($6K gross) and Realistic ($12K gross) scenarios

### Tech stack:
- Pure HTML/CSS/JS (static site, no build tools)
- Chart.js for graphs
- Clean, modern dark theme
- Responsive

### GitHub setup:
- Use CLIO_GITHUB_TOKEN from ~/.openclaw/workspace/.secrets.env
- Repo: clio-ai-dev/fire-cashflow
- Enable GitHub Pages on main branch
