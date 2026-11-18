# 索引

criteria/autonomy	確認なしに進めてよいか、人間に尋ねるべきか迷ったとき	確認なしに進めてよいかは、その操作を取り消せるかで決める。取り消せる操作を「進めてよいですか」と尋ねて止まらず、進めてから結果を見せる。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/autonomy.md
criteria/build-the-tool	些細でない作業を、手で進めようとしているとき	些細でない作業は、手でやらず、それを行う道具か、それを証明する道具を作る。差分に道具が無ければ、この規則を使っていない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/build-the-tool.md
criteria/converge-on-target	段階の境目を決めた、計画された書き直しや移行を進めるとき	書き直しと移行は、目標の形に収束させ、途中のためだけの互換のコードを作らない。途中で壊れてよいのは、計画され、範囲が決まり、取り消せる場合だけである。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/converge-on-target.md
criteria/data-shape-first	ロジックを書き始める前。中心の型とデータ構造、土台と機能の順序、並行する担当が共有するものを決めるとき	ロジックを書く前に、中心のデータの形を決める。形が決まらないまま、処理を書き始めない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/data-shape-first.md
criteria/design-scope	仕組みや手順の設計案を考えるとき、とくに状態、他の実行環境への対応、既存の部分の作り直しを案に含めたくなったとき	設計には、依頼の範囲に要る仕組みだけを置く。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/design-scope.md
criteria/done	作業を完了と報告する前、または成果をレビューで合格とするとき	完了と認めるのは、実物で確かめたときに限る。コンパイルが通ったこと、テストを書いたこと、作業者が確かめたと述べていることは、確認に当たらない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/done.md
criteria/encode-in-structure	同じ指示や訂正を二度目に書こうとしたとき、または繰り返す誤りへの対処を決めるとき	同じ指示を二度書くことになったら、文章を足さず、構造、検査、テスト、道具のどれかに置き換える。構造で直せたなら、指示の文は残さない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/encode-in-structure.md
criteria/explain-the-number	数字を測る前、または測った数字（速度、劣化、処理量、評価の結果）を信じる、報告する、それで決める前	測った数字は、何がその値を決めているかを言えてから信じる。別のものを測っていないかを、証拠で消してから報告する。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/explain-the-number.md
criteria/fix-root-cause	不具合を直すとき、または検査や実行の失敗に対処するとき	誤りは、症状が出た場所ではなく、最初に誤った場所で直す。ガードや再試行を足してよいのは、それが扱う状態が起きてよい状態のときだけである。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/fix-root-cause.md
criteria/harness-shape	ハーネスに部品（知識ファイル、道具）を足すとき、または部品の形を変えるとき	部品の種類は、答える問いで決める。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/harness-shape.md
criteria/idempotent-operations	コマンド、作業の段階、失敗や再試行の中で動く繰り返しを設計するとき	状態を変える操作は、何度実行しても、前回がどこで止まっていても、同じ正しい状態に収束させる。各手順は、前回の意図ではなく、今ある状態から決める。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/idempotent-operations.md
criteria/keep-context-small	大きな出力、長いファイル、繰り返しの読み込み、多数の調べものを前にしたとき	かさばる読み込みと調べものは委任先に回し、手元の文脈には結論だけを置く。要るか分からない大きな出力やファイルの全体を、手元で読まない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/keep-context-small.md
criteria/migrate-then-delete	古い呼び出し側が残っている中で、新しい内部の呼び出し口を入れるとき	内部の呼び出し口を新しくしたら、呼ぶ側をすべて移し、古い方を同じ変更で消す。外の利用者が古い方に頼っているときは、消さない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/migrate-then-delete.md
criteria/model-in-structure	状態を持つ処理、分岐の多い処理、同じ前提を複数のファイルで繰り返す処理を書くとき	繰り返し現れる決まりは、散らばった条件分岐ではなく、一つのデータ構造に持たせる。枝も不正な状態も減らさない抽象は足さない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/model-in-structure.md
criteria/prototype-alternatives	前例の無い操作の設計や構造の判断をするとき。使い心地が理屈ではなく感触で決まる判断をするとき	前例の無い判断は、案を二つか三つ試作して比べてから決める。最初に思いついた案を、比べずに本実装にしない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/prototype-alternatives.md
criteria/redesign-for-requirement	新しい要件を、既存の設計に入れるとき	新しい要件は継ぎ足さず、それが最初からあったらどう作ったかを考えて、要件が触れる部分の設計を直す。要件が触れない部分まで直したくなったら、直さずに選択肢として人間に示す。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/redesign-for-requirement.md
criteria/reduce-reader-load	たどりにくいコードを書く、直す、レビューするとき	読み手がたどる層と、頭に持っておく隠れた状態を減らす。呼び出し元が一つだけの包みと、実装が一つしかない取り持ちは、中に畳む。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/reduce-reader-load.md
criteria/separate-shared-state	並行する処理や担当が、同じ書き込み先を持ちうる設計をするとき	並行する担当が同じファイル、ブランチ、キーに書きそうなら、調整を足す前に、共有そのものを無くす。指示で順番を守らせても、排他の代わりにならない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/separate-shared-state.md
criteria/smallest-change	変更の大きさを決めるとき、または抽象、層、引数の受け渡しを足したくなったとき	問題を解く最小の変更にする。行数の増える整った定型より、少ない行を選ぶ。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/smallest-change.md
criteria/subtract-first	追加、リファクタリング、書き直しの順序を決めるとき	足す前に、要らなくなったものを先に消し、単純になった土台の上に作る。観察されていない使われ方のための検証や分岐を、先回りして足さない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/subtract-first.md
criteria/test-behavior	テストを書く、変える、残すかを決めるとき	テストは、使う側が観察できる振る舞いを確かめる。振る舞いを壊しても通るテストと、内部を変えただけで落ちるテストは、直すか消す。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/test-behavior.md
criteria/test-the-premise	同じ前提に立つ修正が、同じ検査で二度以上失敗したとき	同じ前提に立つ修正が二度失敗したら、次の修正を書く前に、その前提を一文で書き出して直接確かめる。前提を確かめないまま、三つ目の修正を書かない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/test-the-premise.md
criteria/type-out-invalid-states	型のある言語で、型や関数の引数を設計するとき	起きてはならない状態と値の取り違えは、型で書けなくする。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/type-out-invalid-states.md
criteria/user-environment	利用者の環境の設定を変える案や、会話の記録など機微情報を含みうる記録を残す案を考えたとき	利用者の環境の設定は、変えない設計を既定にする。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/user-environment.md
criteria/user-result-first	製品、使い勝手、機能の範囲の兼ね合いを決めるとき	実装の都合と、使う人が得る結果がぶつかったら、使う人の結果を選ぶ。機能、操作、選択肢は、要る理由を一つずつ言えるものだけを入れる。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/user-result-first.md
criteria/validate-at-boundary	検証、エラー処理、外部とのつなぎ込みを書くとき	検証とエラー処理は、データが外から入る境界で行い、内側では型を信じる。境界を越えていないデータに、検証を足さない。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/validate-at-boundary.md
criteria/verify-each-unit	複数の手順から成る作業、とくに同じ形の変更の繰り返し、移行、一括の置き換えを進めるとき。commit の分け方を決めるとき	仕事は、確かめられる状態で終わる小さな単位に分け、一つが通るまで次へ進まない。道具が一括で変える場合も、単位ごとに確かめる。	${CLAUDE_PLUGIN_ROOT}/knowledge/criteria/verify-each-unit.md
procedures/bug-fix	報告された不具合（期待と違う振る舞い、エラー）の原因を突き止めて直すとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/bug-fix.md
procedures/dependency-update	依存、ランタイム、フレームワークの版を上げるとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/dependency-update.md
procedures/design-dialogue	製品、仕組み、文書の構成などの設計を、人間と一つずつ決めながら固め、設計の文書に反映するとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/design-dialogue.md
procedures/design-doc-sync	gori の README と docs/ の下の文書を、既に変わった仕組み（決まった設計、消した部品、変えた名前）に合わせて直すとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/design-doc-sync.md
procedures/feature	チケット、要望、改善候補のプールの一件で示された機能を実装し、レビューを通して PR か main への取り込みまで進めるとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/feature.md
procedures/harness-change	gori の知識ファイル（手順書、判断基準、能力、役割、設定）や、それを支える道具を足す、直す、消すとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/harness-change.md
procedures/improvement-scout	リポジトリから改善候補（不具合、データを壊す振る舞い、保守の弱さ）を根拠付きで探し、改善候補のプールに proposed で起票するとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/improvement-scout.md
procedures/incident-triage	本番で起きている障害の影響を把握し、止血の案を出し、原因の候補を絞るとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/incident-triage.md
procedures/integrate-main	レビューを通って done になった作業のブランチが、その後に main が進んだために fast-forward で入らなくなり、main を取り込んでから main に入れるとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/integrate-main.md
procedures/investigation	コードや挙動についての問いに、変更せずに調べて根拠付きで答えるとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/investigation.md
procedures/learning-apply	改善候補のプールで todo になった学び（kind が learning の一件）を、知識ファイルか道具に適用するとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/learning-apply.md
procedures/planning	一回の作業に収まらない大きな依頼を、作業に分けて計画にするとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/planning.md
procedures/pr-feedback	自分の作業の PR に付いたレビューの指摘に対応するとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/pr-feedback.md
procedures/pr-review	AI レビューとリントを通った後、人間の確認が要ると分類された PR を、人間と一緒にレビューし、pending review を作るとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/pr-review.md
procedures/prune	gori の知識ファイル、道具、テスト、文書から、使われなくなったもの、重複、消えた仕組みの残りを探して刈り込むとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/prune.md
procedures/spike	捨てる前提の試作を作って動かし、設計や技術の問いに答えるとき	${CLAUDE_PLUGIN_ROOT}/knowledge/procedures/spike.md
